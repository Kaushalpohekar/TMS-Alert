// const WebSocket = require('ws');
// const pool = require('./db');
// const fs = require('fs').promises;
// const nodemailer = require('nodemailer');
// const ejs = require('ejs');
// const path = require('path');

// const ws = new WebSocket('ws://localhost:3100');

// ws.on('open', () => {
//     console.log('Connected to the WebSocket server');
//     const subscriptionMessage = JSON.stringify({ action: 'subscribe', topic: 'device/trigger' });
//     ws.send(subscriptionMessage); // Subscribe to a specific topic
// });

// ws.on('message', async (data) => {
//     try {
//         const parsedData = JSON.parse(data);
//         await processData(parsedData);
//     } catch (error) {
//         console.error('Error parsing message:', error);
//     }
// });

// ws.on('close', () => {
//     console.log('Disconnected from the WebSocket server');
// });

// ws.on('error', (error) => {
//     console.error('WebSocket error:', error);
// });

// async function processData(data) {
//     for (const item of data) {
//         if (item.DeviceUID && item.interval) {
//             const deviceUID = item.DeviceUID;
//             const intervalMinutes = parseInt(item.interval);
//             const now = new Date();

//             try {
//                 const lastEntry = await getLastEntry(deviceUID);
//                 if (!lastEntry || isOutsideInterval(lastEntry.lastSend, intervalMinutes)) {
//                     if (item.PersonalEmail) {
//                         await sendMail(item);
//                     } else {
//                         console.log(`No email provided for device ${deviceUID}`);
//                     }
//                     await upsertDeviceEntry(deviceUID, now, 'Trigger');
//                 } else {
//                     console.log(`No alert needed for device: ${deviceUID}`);
//                 }
//             } catch (error) {
//                 console.error(`Error processing device ${deviceUID}:`, error);
//             }
//         } else {
//             console.warn('Invalid item, missing DeviceUID or interval:', item);
//         }
//     }
// }

// function isOutsideInterval(lastSend, intervalMinutes) {
//     const lastSendDate = new Date(lastSend);
//     const now = new Date();
//     const differenceInMinutes = (now - lastSendDate) / (1000 * 60);
//     return differenceInMinutes > intervalMinutes;
// }

// async function getLastEntry(deviceUID) {
//     const query = 'SELECT * FROM tms_alert_interval WHERE DeviceUID = ? and message = ? ORDER BY lastSend DESC LIMIT 1';
//     const [rows] = await pool.execute(query, [deviceUID, 'Trigger']);
//     return rows.length > 0 ? rows[0] : null;
// }

// async function upsertDeviceEntry(deviceUID, timestamp, message) {
//     const query = `
//         INSERT INTO tms_alert_interval (DeviceUID, lastSend, message)
//         VALUES (?, ?, ?)
//         ON DUPLICATE KEY UPDATE lastSend = ?, message = ?
//     `;
//     await pool.execute(query, [deviceUID, timestamp, message, timestamp, message]);
// }

// async function sendMail(Device) {
//     console.log(Device.DeviceUID);
//     const transporter = nodemailer.createTransport({
//         host: 'smtp.gmail.com',
//         port: 465,
//         secure: true,
//         auth: {
//             user: 'donotreplysenselive@gmail.com',
//             pass: 'xgcklimtlbswtzfq', // Consider using an environment variable for security
//         },
//     });

//     const templatePath = path.join(__dirname, './triggerMail.ejs');
//     try {
//         const templateData = await fs.readFile(templatePath, 'utf8');
//         const compiledTemplate = ejs.compile(templateData);
//         const html = compiledTemplate({ Device });

//         const mailOptions = {
//             from: 'donotreplysenselive@gmail.com',
//             //to: 'kpohekar19@gmail.com',
//             to: Device.PersonalEmail,
//             subject: 'Immediate Action Required: Device Trigger Threshold Exceeded',
//             html: html,
//         };

//         const info = await transporter.sendMail(mailOptions);
//         console.log('Email sent:', info.response);
//     } catch (error) {
//         console.error('Error sending email:', error);
//     }
// }

require('dotenv').config();
const WebSocket = require('ws');
const pool = require('./db');
const fs = require('fs').promises;
const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');

// Create WebSocket connection
const ws = new WebSocket('ws://localhost:3100');

// When WebSocket connection is opened
ws.on('open', () => {
    console.log('Connected to the WebSocket server');
    const subscriptionMessage = JSON.stringify({ action: 'subscribe', topic: 'device/trigger' });
    ws.send(subscriptionMessage); // Subscribe to a specific topic
});

// Handle incoming WebSocket messages
ws.on('message', async (data) => {
    try {
        const parsedData = JSON.parse(data);
        await processData(parsedData);
    } catch (error) {
        console.error('Error parsing message:', error);
    }
});

// When WebSocket connection is closed
ws.on('close', () => {
    console.log('Disconnected from the WebSocket server');
});

// When WebSocket encounters an error
ws.on('error', (error) => {
    console.error('WebSocket error:', error);
});

// Main function to process the received data
async function processData(data) {
    const connection = await pool.getConnection();
    await connection.beginTransaction(); // Start a transaction
    try {
        for (const item of data) {
            if (item.DeviceUID && item.interval) {
                const deviceUID = item.DeviceUID;
                const intervalMinutes = parseInt(item.interval);
                const now = new Date();

                const lastEntry = await getLastEntry(connection, deviceUID); // Pass connection for transaction safety
                if (!lastEntry || shouldSendEmail(lastEntry.lastSend, intervalMinutes)) {
                    if (item.PersonalEmail) {
                        await sendMail(item);
                    } else {
                        console.log(`No email provided for device ${deviceUID}`);
                    }
                    await upsertDeviceEntry(connection, deviceUID, now, 'Trigger');
                } else {
                    console.log(`No alert needed for device: ${deviceUID}`);
                }
            } else {
                console.warn('Invalid item, missing DeviceUID or interval:', item);
            }
        }
        await connection.commit(); // Commit the transaction
    } catch (error) {
        await connection.rollback(); // Rollback in case of an error
        console.error('Error processing device data:', error);
    } finally {
        connection.release(); // Release the connection back to the pool
    }
}

// Check if the last email was sent outside the specified interval
function shouldSendEmail(lastSend, intervalMinutes, minIntervalSec = 10) {
    const lastSendDate = new Date(lastSend);
    const now = new Date();
    const differenceInMinutes = (now - lastSendDate) / (1000 * 60);
    const differenceInSeconds = (now - lastSendDate) / 1000;

    return differenceInMinutes > intervalMinutes && differenceInSeconds > minIntervalSec;
}

// Retrieve the last entry for the device from the database
async function getLastEntry(connection, deviceUID) {
    const query = 'SELECT * FROM tms_alert_interval WHERE DeviceUID = ? and message = ? ORDER BY lastSend DESC LIMIT 1';
    const [rows] = await connection.execute(query, [deviceUID, 'Trigger']);
    return rows.length > 0 ? rows[0] : null;
}

// Insert or update the lastSend timestamp for the device in the database
async function upsertDeviceEntry(connection, deviceUID, timestamp, message) {
    const query = `
        INSERT INTO tms_alert_interval (DeviceUID, lastSend, message)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE lastSend = ?, message = ?
    `;
    await connection.execute(query, [deviceUID, timestamp, message, timestamp, message]);
}

// Function to send an email when a trigger is detected
async function sendMail(Device) {
    console.log(Device.DeviceUID);
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,  // Use environment variable
            pass: process.env.EMAIL_PASS,  // Use environment variable
        },
    });

    const templatePath = path.join(__dirname, './triggerMail.ejs');
    try {
        const templateData = await fs.readFile(templatePath, 'utf8');
        const compiledTemplate = ejs.compile(templateData);
        const html = compiledTemplate({ Device });

        const mailOptions = {
            from: process.env.EMAIL_USER, // Use environment variable
            to: Device.PersonalEmail,
            subject: 'Immediate Action Required: Device Trigger Threshold Exceeded',
            html: html,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent:', info.response);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

// Add delay function to throttle requests if needed
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
