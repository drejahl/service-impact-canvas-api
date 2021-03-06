'use strict';
var config = require('./config.json')

const uuidv1 = require('uuid/v1');
var mongoUtils = require('../utilities/mongoUtils')

var util = require('util');

// LOGGING with WinstonJS
const winston = require('winston');
const logger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      json: true,
      timestamp: true,
      handleExceptions: true,
      colorize: false,
    })
  ]
});

const axios = require('axios');

var MongoClient = require('mongodb').MongoClient;

// Mongo URL
const mongourl = process.env.MONGO_STRING;
const dbname = process.env.MONGO_DB_NAME || 'test';

module.exports = {
  canvasFind,
  canvasGet,
  canvasCreate,
  canvasDelete,
  canvasReplace
};

function canvasFind(req, res) {

  // Use connect method to connect to the server
  MongoClient.connect(mongourl, function(err, client) {
    if (err!=null) {
      res.status(500).send({ error: err });
      return;
    }
    const db = client.db(dbname);

    var pageno = req.swagger.params.page.value ? parseInt(req.swagger.params.page.value) : 1;
    var priv = req.swagger.params.private.value;
    var own = req.swagger.params.owning.value;

    // Fixed page size for now

    const pagesize = 100

    const firstitem = (pageno-1)*pagesize
    const lastitem = firstitem + pagesize

    let baseUrl = req.url;

    if (req.url.indexOf("?")>1) {
      baseUrl = req.url.slice( 0, req.url.indexOf("?") );
    }

    // Get the documents collection

    var collection = db.collection('sic');

    var query = {};
    var subQuery = [];

    if ((!own || own==="no") && !priv) {
        query = { $or: [{owner: req.user.sub},{private: false}]};
    } else {
      if (own==="yes" || priv==="yes" ) {
        subQuery.push({owner: req.user.sub});
      }
      if (priv==="yes") {
        subQuery.push({private: true});
      } else if (priv==="no") {
        subQuery.push({private: false});
      }
      if (own==="no" && priv==="yes"){
        res.status(403).send({ error: "Invalid filter" });
        return;
      }
      query = { $and: subQuery };
    }

    // Find some documents
    collection.find(query,
        mongoUtils.fieldFilter(req.swagger.params.fields.value)).toArray(function(err, docs) {
          if (err!=null) {
            res.status(500).send({ error: err });
            return;
          }

        client.close();

        const totalsize = docs.length

        // slice page
        docs = docs.slice( firstitem, lastitem )

        // Generate Canvas Doc
        docs.forEach( function( item ) {
          item = generateHalDoc( item, baseUrl.concat( "/" ).concat( item.id ) )
        })

        // create HAL response

        var halresp = {};

        halresp._links = {
            self: { href: req.url },
            item: []
        }

        halresp._embedded = {item: []}
        halresp._embedded.item = docs

        // Add array of links
        docs.forEach( function( item ) {
            halresp._links.item.push( {
                  href: baseUrl.concat( "/" ).concat( item.id )
                } )
        });

        // Pagination attributes

        halresp.page = pageno
        halresp.totalrecords = totalsize
        halresp.pagesize = pagesize
        halresp.totalpages = Math.ceil(totalsize/pagesize)

        // Create pagination links

        if ( totalsize > (pageno * pagesize) ) {
          halresp._links.next = { href: baseUrl.concat("?page=").concat(pageno+1)}
        }

        halresp._links.first = { href: baseUrl.concat("?page=1")}

        if ( pageno > 1 ) {
          halresp._links.previous = { href: baseUrl.concat("?page=").concat(pageno-1)}
        }

        halresp._links.last = { href: baseUrl.concat("?page=").concat(Math.ceil(totalsize/pagesize)) }

        res.json( halresp );
        });
    })
}

function canvasGet(req, res) {
  var teamArray = [];
  // Retrieve list of teams the user is member of
  axios.get( config.user_api_url + `/${req.user.sub}/organisation`, {
    headers: {
      Authorization: req.headers.authorization,
      Accept: req.headers.accept
    }
  })
  .then( r => {
    r.data._embedded.item.forEach( o => { teamArray.push(o.id); });
    // Use connect method to connect to the server
    MongoClient.connect(mongourl, function(err, client) {
      if (err!=null) {
        res.status(500).send({ error: err });
        return;
      }
      const db = client.db(dbname);

      // Get the documents collection

      var collection = db.collection('sic');
      const query = { id: req.swagger.params.id.value.toString() }

      // Find one document
      collection.findOne( query,
        mongoUtils.fieldFilter(req.swagger.params.fields.value), function(err, doc) {
          if (err!=null) {
            res.status(500).send({ error: err });
            return;
          }

          client.close();

        if ( doc != undefined && ( doc.owner === req.user.sub || doc.private === false || teamArray.indexOf(doc.teamRef)>-1)) {
          const halDoc = generateHalDoc( doc, req.url );

          res.json( halDoc )
        } else {
          logger.info("No canvas found or user not permitted", {user: req.user.sub, sicId: query.id })
          res.status(401).send("Not allowed");
        }
      });
    });
  }).catch( err => {
    console.error("ERROR:", err)
    res.json( err )
  });
}

function canvasCreate(req, res) {
  var canvas = req.swagger.params.canvas.value;

  canvas.id = uuidv1();
  canvas.status = "Draft";
  canvas.owner = req.user.sub;
  canvas.created = Date.now();
  canvas.modified = Date.now();
  canvas.userName = req.user["https://experimenz.com/name"];

  if (canvas.private == null) {
      canvas.private = true;
  }

  let baseUrl = req.url;

  if (req.url.indexOf("?")>1) {
    baseUrl = req.url.slice( 0, req.url.indexOf("?") );
  }
  var self = baseUrl + "/" + canvas.id;

  var mongoDoc = Object.assign( {}, canvas );

  const role = req.user["https://experimenz.com/role"] || "";

  if (role!="admin" && canvas.private===false) {
    res.status(403).send("Your role has no permission to create a public Canvas!");
    return;
  }

  // If canvas is associated with a team, is the user entitled to create a canvas for that team?
  if (canvas.teamRef && canvas.teamRef != "") {

    // HACK - implementation missing
  }

  // Use connect method to connect to the server
  MongoClient.connect(mongourl, function(err, client) {
    if (err!=null) {
      res.status(500).send({ error: err });
      return;
    }
    const db = client.db(dbname);

    // Get the documents collection
    var collection = db.collection('sic');

    collection.find({owner: req.user.sub}).toArray(function(err, docs) {
      if (err!=null) {
        res.status(500).send({ error: err });
        return;
      }

      const quota = req.user["https://experimenz.com/sicQuota"] || 5;

      if ( docs.length < quota ) {
        // Insert some documents
        collection.insert( mongoDoc, function(err, result) {
          if (err!=null) {
            res.status(500).send({ error: err });
            return;
          }
          client.close();
          res.json( generateHalDoc( canvas, self ));
        });
      } else {
        client.close();
        res.status(403).send("Maximum number of Service Impact Canvases exceeded! Upgrade your subscription!");
      }
    });
  });
}

function canvasReplace(req, res) {
  var canvas = req.swagger.params.canvas.value;
  var id = req.swagger.params.id.value;

  canvas.modified = Date.now();

  let baseUrl = req.url;

  if (req.url.indexOf("?")>1) {
    baseUrl = req.url.slice( 0, req.url.indexOf("?") );
  }
  var self = baseUrl + "/" + canvas.id;

  var mongoDoc = Object.assign( {}, canvas );

  const role = req.user["https://experimenz.com/role"] || "";

  // Use connect method to connect to the server
  MongoClient.connect(mongourl, function(err, client) {
    if (err!=null) {
      res.status(500).send({ error: err });
      return;
    }
    const db = client.db(dbname);

    // Get the documents collection
    var collection = db.collection('sic');

    // Find one document
    collection.findOne( {id: id}, function(err, doc) {
      if (err!=null) {
        res.status(500).send({ error: err });
        return;
      }

      if (role!="admin" && doc.private===false && doc.owner !== req.user.sub) {
        res.status(403).send("Your role has no permission to update a public Canvas!");
        client.close();
        return;
      }
      // Push reference to experiment doc
      collection.update( {id: id}, mongoDoc, function(err, result) {
        if (err!=null) {
          res.status(500).send({ error: err });
          return;
        }

        client.close();
        res.json( generateHalDoc( canvas, self ));
      });
    });
  });
}

function canvasDelete(req, res) {
  var id = req.swagger.params.id.value;

  // Use connect method to connect to the server
  MongoClient.connect(mongourl, function(err, client) {
    if (err!=null) {
      res.status(500).send({ error: err });
      return;
    }
    const db = client.db(dbname);

    const role = req.user["https://experimenz.com/role"] || "";

    // Get the documents collection
    var collection = db.collection('sic');

    // Find one document
    collection.findOne( {id: id}, function(err, doc) {
        if (err!=null) {
          res.status(500).send({ error: err });
          return;
        }

        if (role!="admin" && doc.private===false) {
          res.status(403).send("Your role has no permission to delete a public Canvas!");
          client.close();
          return;
        }

        collection.deleteOne( {id: id}, function(err, result) {
          if (err!=null) {
            res.status(500).send({ error: err });
            return;
          }

          client.close();
          res.status(200).send();
      });
    });
  });
}

function generateHalDoc( doc, url ) {
  // delete the mongodb _id attribute from the JSON document
  delete doc["_id"]

  // create _links

  doc._links= {
            self: {
                href: url
                }
            }

  // create _actions

  doc._actions = [];

  return doc;
}
