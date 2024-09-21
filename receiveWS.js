require('dotenv').config();
const WebSocket = require('ws');
const pool = require('./db');
const fs = require('fs').promises;
const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');

const ws = new WebSocket('ws://localhost:3100');

ws.on('open', () => {
    console.log('Connected to the WebSocket server');
    const subscriptionMessage = JSON.stringify({ action: 'subscribe', topic: 'device/trigger' });
    ws.send(subscriptionMessage); // Subscribe to a specific topic
});

ws.on('message', async (data) => {
    try {
        const parsedData = JSON.parse(data);
        await processData(parsedData);
    } catch (error) {
        console.error('Error parsing message:', error);
    }
});

ws.on('close', () => {
    console.log('Disconnected from the WebSocket server');
});

ws.on('error', (error) => {
    console.error('WebSocket error:', error);
});

async function processData(data) {
    for (const item of data) {
        if (item.DeviceUID && item.interval) {
            const deviceUID = item.DeviceUID;
            const intervalMinutes = parseInt(item.interval);
            const now = new Date();

            try {
                const lastEntry = await getLastEntry(deviceUID);
                if (!lastEntry || isOutsideInterval(lastEntry.lastSend, intervalMinutes)) {
                    if (item.PersonalEmail) {
                        await sendMail(item);
                    } else {
                        console.log(`No email provided for device ${deviceUID}`);
                    }
                    await upsertDeviceEntry(deviceUID, now, 'Trigger');
                } else {
                    console.log(`No alert needed for device: ${deviceUID}`);
                }
            } catch (error) {
                console.error(`Error processing device ${deviceUID}:`, error);
            }
        } else {
            console.warn('Invalid item, missing DeviceUID or interval:', item);
        }
    }
}

function isOutsideInterval(lastSend, intervalMinutes) {
    const lastSendDate = new Date(lastSend);
    const now = new Date();
    const differenceInMinutes = (now - lastSendDate) / (1000 * 60);
    return differenceInMinutes > intervalMinutes;
}

async function getLastEntry(deviceUID) {
    const query = 'SELECT * FROM tms_alert_interval WHERE DeviceUID = ? and message = ? ORDER BY lastSend DESC LIMIT 1';
    const [rows] = await pool.execute(query, [deviceUID, 'Trigger']);
    return rows.length > 0 ? rows[0] : null;
}

async function upsertDeviceEntry(deviceUID, timestamp, message) {
    const query = `
        INSERT INTO tms_alert_interval (DeviceUID, lastSend, message)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE lastSend = ?, message = ?
    `;
    await pool.execute(query, [deviceUID, timestamp, message, timestamp, message]);
}

async function sendMail(Device) {
    console.log(Device.DeviceUID);
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    const templatePath = path.join(__dirname, './triggerMail.ejs');
    try {
        const templateData = await fs.readFile(templatePath, 'utf8');
        const compiledTemplate = ejs.compile(templateData);
        const html = compiledTemplate({ Device });

        const mailOptions = {
            from: 'donotreplysenselive@gmail.com',
            //to: 'kpohekar19@gmail.com',
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
