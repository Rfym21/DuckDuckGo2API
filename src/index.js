const express = require('express')
const dotenv = require('dotenv')
const bodyParser = require('body-parser')
const { CreateRequest, ParseResponse } = require('./api.js')

// -----------------------------------------------------------------------------------
// 加载环境变量
dotenv.config()

const SERVICE_PORT = process.env.SERVICE_PORT || 8333
const MODELS = process.env.MODELS || "claude-3-haiku-20240307,gpt-4o-mini,meta-llama/Llama-3.3-70B-Instruct-Turbo,o3-mini,mistralai/Mixtral-8x7B-Instruct-v0.1"
const models = MODELS.split(',')

console.log(`----------- 环境变量 -----------`)
console.log(`SERVICE_PORT: ${SERVICE_PORT}`)
console.log(`MODELS: ${MODELS}`)
console.log(`PROXY_MODE: ${process.env.PROXY_MODE}`)
console.log(`PROXY_URL: ${process.env.PROXY_URL}`)
console.log(`----------- 环境变量 -----------`)
// -----------------------------------------------------------------------------------
// 创建express实例
const app = express()
app.use(bodyParser.json())


app.get('/', (req, res) => {
  res.send(`${new Date().toLocaleString()} : API is running`)
})

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, stream } = req.body
    // console.log(model, messages, stream)
    const response = await CreateRequest(model, messages)
    if (response.status === 200) {
      ParseResponse(response, res, stream)
    }
  } catch (error) {
    console.error('多次尝试后失败！！！')
    res.json({
      status: 429,
      message: "触发429限速！！！"
    })
  }
})



app.get('/v1/models', (req, res) => {
  res.json({
    "data": models.map(item => ({
      "id": item,
      "object": "model",
      "created": 1626777600,
      "owned_by": "openai",
      "root": item,
    })),
    "success": true
  })
})


app.listen(SERVICE_PORT, () => {
  console.log(`Server is running on port http://localhost:${SERVICE_PORT}`)
})



