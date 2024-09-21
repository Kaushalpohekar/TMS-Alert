const { fork } = require('child_process');
const path = require('path');

console.log('Starting the server...');
const serverProcess = fork(path.join(__dirname, 'sendWS.js'));

serverProcess.on('message', (msg) => {
    console.log(`Server: ${msg}`);
});

setTimeout(() => {
    console.log('Starting the client after 5 seconds...');
    const clientProcess = fork(path.join(__dirname, 'receiveWS.js'));
    
    clientProcess.on('message', (msg) => {
        console.log(`Client: ${msg}`);
    });
}, 5000);  // 5000 milliseconds = 5 seconds
