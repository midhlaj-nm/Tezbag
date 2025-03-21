const express = require('express')
const app = express()
const port = 2026

app.get('/',(req,res)=>{
    res.send('New server')
})

app.listen(port,()=>{
    console.log(`Page is running on ${port}`)
})