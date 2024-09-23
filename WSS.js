// const connections = require('./db');
// const WebSocket = require('ws');
// const https = require('https');
// const fs = require('fs');

// const options = {
//     cert: fs.readFileSync('/etc/letsencrypt/live/senso.senselive.in/fullchain.pem'),
//     key: fs.readFileSync('/etc/letsencrypt/live/senso.senselive.in/privkey.pem')
// };

// const server = https.createServer(options);
// const wss = new WebSocket.Server({ server });

// const PORT = 3100;
// const subscriptions = {};

// wss.on('connection', (ws) => {
//     ws.on('message', (message) => {
//         try {
//             const parsedMessage = message.toString();
//             const { action, topic } = JSON.parse(parsedMessage);

//             if (action === 'subscribe') {
//                 subscriptions[topic] = subscriptions[topic] || [];
//                 subscriptions[topic].push(ws);
//             }
//         } catch (error) {
//             console.error('Error parsing message:', error);
//         }
//     });

//     ws.on('close', () => {
//         Object.keys(subscriptions).forEach(topic => {
//             subscriptions[topic] = subscriptions[topic].filter(client => client !== ws);
//         });
//     });
// });

// server.listen(PORT, '0.0.0.0', () => {
//     console.log(`WebSocket server is listening on wss://senso.senselive.in:${PORT}`);
// });

// async function fetchData() {
//     try {
//         const connection = await connections.getConnection();
//         const query = `
//             SELECT d.DeviceUID, d.DeviceName, d.DeviceType, t.PersonalEmail, t.TriggerValue,
//                    t.Whatsapp, t.Mail, t.interval, a.DeviceUID, a.TimeStamp, 
//                    a.Temperature, a.TemperatureR, a.TemperatureY, a.TemperatureB, 
//                    a.flowRate, a.Pressure
//             FROM tms_devices d
//             JOIN tms_trigger t ON d.DeviceUID = t.DeviceUID
//             JOIN (SELECT DeviceUID, MAX(TimeStamp) AS LatestTimeStamp
//                   FROM actual_data GROUP BY DeviceUID) latest
//             ON d.DeviceUID = latest.DeviceUID
//             JOIN actual_data a ON a.DeviceUID = latest.DeviceUID 
//             AND a.TimeStamp = latest.LatestTimeStamp
//             WHERE (a.Temperature >= t.TriggerValue OR a.TemperatureR >= t.TriggerValue
//                    OR a.TemperatureY >= t.TriggerValue OR a.TemperatureB >= t.TriggerValue
//                    OR a.flowRate >= t.TriggerValue OR a.Pressure >= t.TriggerValue)
//             AND (t.Mail = '1' OR t.Whatsapp = '1')
//             AND a.TimeStamp >= NOW() - INTERVAL 1 HOUR;
//         `;
//         const [rows] = await connection.execute(query);
//         connection.release();
//         return rows;
//     } catch (error) {
//         console.error('Error fetching data:', error);
//         throw error;
//     }
// }

// async function fetchDataPeriodically() {
//     try {
//         const data = await fetchData();
//         data.forEach((deviceData) => {
//             const topic = `device/trigger/${deviceData.DeviceUID}`;
//             if (subscriptions[topic]) {
//                 subscriptions[topic].forEach(client => {
//                     if (client.readyState === WebSocket.OPEN) {
//                         client.send(JSON.stringify(deviceData));
//                     }
//                 });
//             }
//         });
//     } catch (error) {
//         console.error('Error fetching or sending data:', error);
//     }
// }

// setInterval(fetchDataPeriodically, 5000);
const connections = require('./db');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const pool = require('./db'); // Assuming this is the MySQL pool

const options = {
    cert: fs.readFileSync('/etc/letsencrypt/live/senso.senselive.in/fullchain.pem'),
    key: fs.readFileSync('/etc/letsencrypt/live/senso.senselive.in/privkey.pem')
};

const server = https.createServer(options);
const wss = new WebSocket.Server({ server });

const PORT = 3100;
const subscriptions = {};

// WebSocket connection handling
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const parsedMessage = JSON.parse(message.toString());
            const { action, topic } = parsedMessage;

            if (action === 'subscribe') {
                subscriptions[topic] = subscriptions[topic] || [];
                subscriptions[topic].push(ws);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        Object.keys(subscriptions).forEach(topic => {
            subscriptions[topic] = subscriptions[topic].filter(client => client !== ws);
        });
    });
});

// Function to fetch data from the database
async function fetchData() {
    try {
        const connection = await connections.getConnection();
        const query = `
            SELECT d.DeviceUID, d.DeviceName, d.DeviceType, t.TriggerValue, t.interval,
                   a.DeviceUID, a.TimeStamp, a.Temperature, a.TemperatureR, a.TemperatureY, a.TemperatureB,
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

// Check if a device's data should be sent based on the interval
async function shouldSendData(deviceUID, intervalMinutes) {
    const query = 'SELECT * FROM tms_alert_interval WHERE DeviceUID = ? ORDER BY lastSend DESC LIMIT 1';
    const [rows] = await pool.execute(query, [deviceUID]);
    
    if (rows.length > 0) {
        const lastSend = rows[0].lastSend;
        const now = new Date();
        const differenceInMinutes = (now - new Date(lastSend)) / (1000 * 60);
        return differenceInMinutes > intervalMinutes;
    }
    
    return true; // If no previous record, send data
}

// Update the `tms_alert_interval` table
async function updateAlertInterval(deviceUID) {
    const now = new Date();
    const query = `
        INSERT INTO tms_alert_interval (DeviceUID, lastSend, message)
        VALUES (?, ?, 'Trigger');
    `;
    await pool.execute(query, [deviceUID, now, now]);
}

// Fetch data periodically and send it to clients if the interval allows
async function fetchDataPeriodically() {
    try {
        const data = await fetchData();
        
        for (const deviceData of data) {
            const { DeviceUID, interval } = deviceData;
            const topic = `device/trigger/${DeviceUID}`;

            // Check if we should send the data based on the interval
            const sendData = await shouldSendData(DeviceUID, parseInt(interval));

            if (sendData && subscriptions[topic]) {
                // Send data to all subscribed clients for this topic
                subscriptions[topic].forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(deviceData));
                    }
                });
                
                // Update the alert interval in the database
                await updateAlertInterval(DeviceUID);
            } else {
                console.log(`Data for DeviceUID ${DeviceUID} is within the interval, not sending.`);
            }
        }
    } catch (error) {
        console.error('Error fetching or sending data:', error);
    }
}

// Set an interval to fetch and send data every 5 seconds
setInterval(fetchDataPeriodically, 5000);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`WebSocket server is listening on wss://senso.senselive.in:${PORT}`);
});
