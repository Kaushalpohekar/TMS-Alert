const connections = require('./db');
const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });
const PORT = 3100;
const subscriptions = {};

wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket server');

    ws.on('message', (message) => {
        const { action, topic } = JSON.parse(message);
        if (action === 'subscribe') {
            subscriptions[topic] = subscriptions[topic] || [];
            subscriptions[topic].push(ws);
            console.log(`Client subscribed to topic: ${topic}`);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected from WebSocket server');
        Object.keys(subscriptions).forEach(topic => {
            subscriptions[topic] = subscriptions[topic].filter(client => client !== ws);
        });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`WebSocket server is listening on ws://senso.senslive.in:${PORT}`);
});


async function fetchData() {
    try {
        const connection = await connections.getConnection();
        const query = `
            SELECT d.DeviceUID, d.DeviceName, d.DeviceType, t.PersonalEmail, t.TriggerValue,
                   t.Whatsapp, t.Mail, t.interval, a.DeviceUID, a.TimeStamp, 
                   a.Temperature, a.TemperatureR, a.TemperatureY, a.TemperatureB, 
                   a.flowRate, a.Pressure
            FROM tms_devices d
            JOIN tms_trigger t ON d.DeviceUID = t.DeviceUID
            JOIN (SELECT DeviceUID, MAX(TimeStamp) AS LatestTimeStamp
                  FROM actual_data GROUP BY DeviceUID) latest
            ON d.DeviceUID = latest.DeviceUID
            JOIN actual_data a ON a.DeviceUID = latest.DeviceUID 
            AND a.TimeStamp = latest.LatestTimeStamp
            WHERE (a.Temperature >= t.TriggerValue OR a.TemperatureR >= t.TriggerValue
                   OR a.TemperatureY >= t.TriggerValue OR a.TemperatureB >= t.TriggerValue
                   OR a.flowRate >= t.TriggerValue OR a.Pressure >= t.TriggerValue)
            AND (t.Mail = '1' OR t.Whatsapp = '1')
            AND a.TimeStamp >= NOW() - INTERVAL 1 HOUR;
        `;
        const [rows] = await connection.execute(query);
        connection.release();
        return rows;
    } catch (error) {
        console.error('Error fetching data:', error);
        throw error;
    }
}

async function fetchDataPeriodically() {
    try {
        const data = await fetchData();
        const topic = 'device/trigger'; // Update this logic as needed
        if (subscriptions[topic]) {
            subscriptions[topic].forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        }
    } catch (error) {
        console.error('Error fetching or sending data:', error);
    }
}

setInterval(fetchDataPeriodically, 5000);

