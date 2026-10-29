const fs = require('node:fs/promises');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { connectMongo, getMongoDb, closeMongo } = require('./mongo');
const { pool, query, closePostgres } = require('./postgres');
const { adminEmail, adminPassword } = require('../config');

const nodes = [
  ['depot','Repair Depot','Central','depot',50,225],
  ['west-gate','West Gate','West','gate',170,90],
  ['north-junction','North Junction','North','junction',300,90],
  ['central-square','Central Square','Central','junction',300,225],
  ['library','Public Library','North','facility',455,65],
  ['clinic','Community Clinic','East','facility',475,180],
  ['market','Main Market','South-East','facility',455,335],
  ['south-school','South School','South','facility',300,365],
  ['east-residential','East Residential','East','junction',625,225],
  ['hospital','District Hospital','North-East','facility',745,100],
  ['bus-stand','Bus Stand','West','facility',75,335]
];
const edges = [
  ['depot','west-gate',1.1],['depot','central-square',0.8],['depot','bus-stand',1.0],
  ['west-gate','north-junction',0.9],['west-gate','central-square',1.2],
  ['north-junction','central-square',0.7],['north-junction','library',0.8],['north-junction','hospital',1.8],
  ['central-square','library',1.5],['central-square','clinic',1.0],['central-square','south-school',1.2],
  ['central-square','east-residential',1.4],['clinic','hospital',1.1],['clinic','east-residential',0.8],
  ['clinic','market',1.4],['market','east-residential',1.1],['market','south-school',1.3],
  ['south-school','bus-stand',1.4],['west-gate','bus-stand',1.7],['hospital','east-residential',1.5]
];
const sampleReports = [
  { title:'Deep pothole near Central Square', description:'A deep pothole is causing two-wheelers to swerve into traffic during busy hours.', category:'Road damage', nodeId:'central-square', severity:5, estimatedCost:18000, estimatedHours:7 },
  { title:'Streetlight out at North Junction', description:'The main streetlight has been out for several nights, making the crossing hard to see.', category:'Streetlight', nodeId:'north-junction', severity:4, estimatedCost:8000, estimatedHours:3 },
  { title:'Broken sidewalk at West Gate', description:'A cracked sidewalk makes the entry path difficult for people using mobility aids.', category:'Accessibility', nodeId:'west-gate', severity:4, estimatedCost:14000, estimatedHours:6 },
  { title:'Overflowing public bin at Main Market', description:'The market-side public bin is overflowing and waste is spreading onto the walking path.', category:'Waste', nodeId:'market', severity:2, estimatedCost:4000, estimatedHours:2 },
  { title:'Water leak in East Residential', description:'Clean water has been flowing from a damaged public pipe by the residential junction.', category:'Water leak', nodeId:'east-residential', severity:5, estimatedCost:26000, estimatedHours:9 },
  { title:'Blocked step-free ramp by the clinic', description:'A damaged ramp surface blocks a step-free route into the community clinic.', category:'Accessibility', nodeId:'clinic', severity:5, estimatedCost:9000, estimatedHours:4 },
  { title:'Road surface broken near South School', description:'Broken road surface near the school crossing needs repair before school traffic peaks.', category:'Road damage', nodeId:'south-school', severity:5, estimatedCost:22000, estimatedHours:8 },
  { title:'Lamp flickering at the public library', description:'The path light beside the public library keeps switching off at night.', category:'Streetlight', nodeId:'library', severity:3, estimatedCost:6000, estimatedHours:2 }
];

async function seed() {
  await connectMongo();
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(schema);
  for (const [id,name,zone,kind,map_x,map_y] of nodes) {
    await query(`INSERT INTO graph_nodes (id,name,zone,kind,map_x,map_y) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,zone=EXCLUDED.zone,kind=EXCLUDED.kind,map_x=EXCLUDED.map_x,map_y=EXCLUDED.map_y`, [id,name,zone,kind,map_x,map_y]);
  }
  for (const [a,b,distance] of edges) {
    await query(`INSERT INTO graph_edges (source_node_id,target_node_id,distance_km,is_closed) VALUES ($1,$2,$3,FALSE) ON CONFLICT (source_node_id,target_node_id) DO UPDATE SET distance_km=EXCLUDED.distance_km`, [a,b,distance]);
  }
  const adminHash = await bcrypt.hash(adminPassword, 12);
  await query(`INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,'admin') ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,role='admin'`, ['CivicFix Local Admin',adminEmail,adminHash]);
  const crewRows = [
    ['Road Repair Crew','Road surfaces','depot'],['Electrical Crew','Streetlights','north-junction'],['Water Services Crew','Water infrastructure','clinic'],['Accessibility Crew','Sidewalks and ramps','west-gate']
  ];
  for (const [name,specialty,base] of crewRows) {
    await query(`INSERT INTO crews (name,specialty,base_node_id,active) SELECT $1::varchar(120),$2::varchar(100),$3::varchar(60),TRUE WHERE NOT EXISTS (SELECT 1 FROM crews WHERE name=$1::varchar(120))`, [name,specialty,base]);
  }
  const collection = getMongoDb().collection('reports');
  if (await collection.countDocuments() === 0) {
    for (const report of sampleReports) {
      const nodeName = nodes.find((n) => n[0] === report.nodeId)?.[1] || report.nodeId;
      await collection.insertOne({ ...report, locationName: nodeName, status:'Open', createdBy:null, createdAt:new Date(Date.now() - Math.floor(Math.random()*20)*86_400_000), updatedAt:new Date() });
    }
  }
  console.log(`Seed complete. Local admin: ${adminEmail}`);
  console.log('Demo credentials are for local development only. Change/remove them before any deployment.');
}

seed().catch((error) => { console.error('Seed failed:', error); process.exitCode = 1; }).finally(async () => { await Promise.allSettled([closeMongo(), closePostgres()]); });
