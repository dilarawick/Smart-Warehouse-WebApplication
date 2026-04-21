const mqtt = require('mqtt');

const BROKER = 'mqtt://fd9d4523e84b4b22b1f3ff686ffbc123.s1.eu.hivemq.cloud';
const USERNAME = 'Dilara';
const PASSWORD = 'Dilara@2005';
const BELT_ID = 'Belt-1';

const client = mqtt.connect(BROKER, {
  username: USERNAME,
  password: PASSWORD,
  clientId: 'Simulator-' + Math.random().toString(16).slice(2),
});

client.on('connect', () => {
  console.log('[MQTT] Connected! Starting simulation...');
  
  const boxes = [
    { box_id: 'BOX-A-001', category: 'A' },
    { box_id: 'BOX-B-001', category: 'B' },
    { box_id: 'BOX-A-002', category: 'A' },
    { box_id: 'BOX-B-002', category: 'B' },
  ];

  let index = 0;
  const interval = setInterval(() => {
    const box = boxes[index];
    const topic = `warehouse/${BELT_ID}/scan`;
    const payload = JSON.stringify({
      box_id: box.box_id,
      category: box.category,
      action: box.category === 'A' ? 'SLIDE_A' : 'PASS_B',
      belt_id: BELT_ID,
    });
    
    client.publish(topic, payload);
    console.log(`[SCAN] ${box.box_id} -> Category ${box.category} (${payload})`);
    
    index = (index + 1) % boxes.length;
  }, 5000);
});

client.on('error', (err) => {
  console.error('[MQTT] Error:', err.message);
});