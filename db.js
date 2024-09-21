const mysql = require('mysql2/promise');
require('dotenv').config()

const connections=mysql.createPool({
    connectionLimit: 20,
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    // connectionTimeout:100000

});

connections.getConnection((connectionError,connectionRessult)=>{
    if(connectionError){
        console.log("error connecting to database",connectionError)
        return;
    }
    console.log("connected to mysql database")
})

module.exports=connections;