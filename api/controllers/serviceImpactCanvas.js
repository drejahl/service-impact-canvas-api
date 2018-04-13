'use strict';

const uuidv1 = require('uuid/v1');
var mongoUtils = require('../utilities/mongoUtils')

var util = require('util');

//var mongoUtils = require('../utilities/mongoUtils')

var MongoClient = require('mongodb').MongoClient;

// Mongo URL
const mongourl = process.env.MONGO_STRING;

module.exports = {
  canvasFind,
  canvasGet,
  canvasCreate,
  canvasReplace
};

function canvasFind(req, res) {

  // Use connect method to connect to the server
  MongoClient.connect(mongourl, function(err, db) {
    if (err!=null) {
      res.status(500).send({ error: err });
      return;
    }

    var pageno = req.swagger.params.page.value ? parseInt(req.swagger.params.page.value) : 1;

    // Fixed page size for now

    const pagesize = 5

    const firstitem = (pageno-1)*pagesize
    const lastitem = firstitem + pagesize

    let baseUrl = req.url;

    if (req.url.indexOf("?")>1) {
      baseUrl = req.url.slice( 0, req.url.indexOf("?") );
    }

    // Get the documents collection

    var collection = db.collection('sic');

    // Find some documents
    collection.find({ $or: [ {owner: req.user.sub}, {private: false} ]},
        mongoUtils.fieldFilter(req.swagger.params.fields.value)).toArray(function(err, docs) {
          if (err!=null) {
            res.status(500).send({ error: err });
            return;
          }

        db.close();

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

  // Use connect method to connect to the server
  MongoClient.connect(mongourl, function(err, db) {
    if (err!=null) {
      res.status(500).send({ error: err });
      return;
    }

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

        db.close();

      if ( doc != undefined && ( doc.owner === req.user.sub || doc.private === false )) {
        const halDoc = generateHalDoc( doc, req.url );

        res.json( halDoc )
      } else {
        // Error handling missing [To-Do]
        res.json( "{}")
      }
    });
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

  let baseUrl = req.url;

  if (req.url.indexOf("?")>1) {
    baseUrl = req.url.slice( 0, req.url.indexOf("?") );
  }
  var self = baseUrl + "/" + canvas.id;

  var mongoDoc = Object.assign( {}, canvas );

  // Use connect method to connect to the server
  MongoClient.connect(mongourl, function(err, db) {
    if (err!=null) {
      res.status(500).send({ error: err });
      return;
    }

    // Get the documents collection
    var collection = db.collection('sic');
    // Insert some documents
    collection.insert( mongoDoc, function(err, result) {
      if (err!=null) {
        res.status(500).send({ error: err });
        return;
      }

      db.close();
      });
    });
  res.json( generateHalDoc( canvas, self ));
}

function canvasReplace(req, res) {
  var canvas = req.swagger.params.canvas.value;
  var id = req.swagger.params.id.value;

  let baseUrl = req.url;

  if (req.url.indexOf("?")>1) {
    baseUrl = req.url.slice( 0, req.url.indexOf("?") );
  }
  var self = baseUrl + "/" + canvas.id;

  var mongoDoc = Object.assign( {}, canvas );

  // Use connect method to connect to the server
  MongoClient.connect(mongourl, function(err, db) {
    if (err!=null) {
      res.status(500).send({ error: err });
      return;
    }

    // Get the documents collection
    var collection = db.collection('sic');
    // Push reference to experiment doc
    collection.update( {id: id}, mongoDoc, function(err, result) {
      if (err!=null) {
        res.status(500).send({ error: err });
        return;
      }

      db.close();
    });
  });
  res.json( generateHalDoc( canvas, self ));
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
