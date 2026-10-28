const { MongoClient } = require('mongodb');
const { mongoUri, mongoDb } = require('../config');

const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
let database;

async function connectMongo() {
  if (database) return database;
  await client.connect();
  database = client.db(mongoDb);
  await database.collection('reports').createIndex({ createdAt: -1 });
  await database.collection('reports').createIndex({ status: 1, severity: -1 });
  await database.collection('reports').createIndex({ nodeId: 1 });
  return database;
}

function getMongoDb() {
  if (!database) throw new Error('MongoDB is not connected. Start the database and restart the server.');
  return database;
}

async function closeMongo() {
  await client.close();
  database = undefined;
}

module.exports = { connectMongo, getMongoDb, closeMongo };
