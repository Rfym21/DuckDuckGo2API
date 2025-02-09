const axios = require('axios')
const { HttpsProxyAgent } = require('https-proxy-agent')
const { SocksProxyAgent } = require('socks-proxy-agent')
const vqdMap = new Map()
const RETRY_COUNT = Number(process.env.RETRY_COUNT) || 5

setInterval(() => {
  // console.log(vqdMap)
  vqdMap.clear()
}, process.env.VQD_CLEAR_INTERVAL || 3 * 60 * 60 * 1000)


const CreateRequest = async (model, messages) => {
  const oldMessages = messages.filter(item => item.role !== 'system')

  let vqd = oldMessages.length === 1 ? '4-273102948702639935340411029613511142910' : vqdMap.get(oldMessages[oldMessages.length - 2].content)
  if (vqd !== '4-273102948702639935340411029613511142910' && vqd !== null && vqd !== undefined) {
    console.log("成功匹配上文x-vqd-4: ", vqd)
  }

  const headers = {
    'Connection': 'keep-alive',
    'Accept': 'text/event-stream',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Content-Type': 'application/json',
    'x-vqd-4': vqd ? vqd : '4-273102948702639935340411029613511142910',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0'
  }

  // console.log(headers)
  const createMessage = {
    'role': 'user',
    'content': `
      <input>标签内是用户输入的文本,<history>标签内是以往的对话,严格遵循<prompt>标签内的prompt,正常输出结果即可,无需使用特殊格式！！！
      
      <input>
      ${messages[messages.length - 1].content}
      </input>
      <history>
      ${JSON.stringify(messages)}
      </history>
      <prompt>
      ${JSON.stringify(messages.filter(item => item.role === 'system'))}
      </prompt>
      `
  }
  if (!vqd) {
    // console.log(createMessage)
  }

  const body = JSON.stringify({
    'model': model,
    'messages': vqd ? oldMessages: [createMessage]
  })

  // console.log(body)

  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const response = await axios.post('https://duckduckgo.com/duckchat/v1/chat', body, { headers, responseType: 'stream', proxy: await getProxyAgent() })
      // console.log(response.headers.get('x-vqd-4'))
      if (response.status == 200) {
        return response
      }
    } catch (error) {
      // console.error('请求失败:', error)
      if (error.status == 429) {
        console.log(error.status, "触发429限速！！！")
        await sleep(5000)
      } else if (error.status == 400 || error.status == 418) {
        console.log(error.status, "触发400或418错误！！！")
        vqd = null
        await sleep(5000)
      }
    }
  }

}



const ParseResponse = async (response, res, stream = true) => {
  // 设置流式响应
  if (stream === true) {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
  } else {
    res.set({
      'Content-Type': 'application/json',
    })
  }
  let resultBody = {
    "id": null,
    "model": null,
    "object": "chat.completion",
    "created": null,
    "choices": [
      {
        "index": 0,
        "message": {
          "role": "assistant",
          "content": ""
        },
        "finish_reason": "stop"

      }
    ],
    "usage": {
      "prompt_tokens": 1024,
      "completion_tokens": 1024,
      "total_tokens": 2048
    }
  }

  // 创建解码器
  const decoder = new TextDecoder('utf-8')

  // 处理数据流
  response.data.on('data', (chunk) => {
    // 解码二进制数据
    const text = decoder.decode(chunk)
    const lines = text.split('\n').filter(item => item.trim() !== '')
    // 遍历数据块
    for (const line of lines) {
      // 如果数据块为空，则跳过
      if (line.trim() === '') {
        continue
      }
      // 如果数据块为[DONE]，则结束
      if (line.trim() === 'data: [DONE]') {
        break
      }
      try {
        // 移除 "data: " 前缀并解析 JSON
        const verifyJson = isJson(line.replace(/^data: /, ''))
        if (!verifyJson) {
          continue
        }
        const json = JSON.parse(line.replace(/^data: /, ''))
        // 流式响应
        if (stream === true) {
          streamWrite(json)
        }
        writeContent(json)
      } catch (error) {
        console.error('解析数据块出错:', error)
      }
    }
  })

  // 错误处理
  response.data.on('error', (error) => {
    res.status(500)
    res.json({
      status: 500,
      error: "服务异常，请查看日志！"
    })
  })

  response.data.on('end', () => {
    vqdMap.set(resultBody.choices[0].message.content, response.headers['x-vqd-4'])
    // console.log(vqdMap)
    if (stream === true) {
      res.write('data: [DONE]\n\n')
      res.end()

    } else {
      // console.log(resultBody.choices[0].message.content)
      res.json(resultBody)
    }
  })



  const streamWrite = (json) => {
    if (!json.message) {
      return
    }

    res.write(`data: ${JSON.stringify({
      "id": json.id,
      "object": "chat.completion.chunk",
      "created": json.created,
      "model": json.model,
      "system_fingerprint": "fp_a24b4d720c",
      "choices": [
        {
          "index": 0,
          "delta": {
            "content": json.message
          },
          "logprobs": null,
          "finish_reason": null
        }
      ]
    })}\n\n`)
  }

  const writeContent = (json) => {
    if (!json.message) {
      return
    }
    resultBody.choices[0].message.content += json.message
    resultBody.id = json.id
    resultBody.model = json.model
    resultBody.created = json.created
  }

}

const getProxyAgent = async () => {
  // 判断代理模式
  const proxy_mode = process.env.PROXY_MODE
  const proxy_url = process.env.PROXY_URL
  let proxyAgent = null

  const parseProxyUrl = (url) => {
    if (url.includes("http")) {
      // http://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}
      return new HttpsProxyAgent(url)
    } else if (url.includes("socks5")) {
      // socks5://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}
      return new SocksProxyAgent(url)
    }
  }

  if (proxy_mode == "only") {
    proxyAgent = parseProxyUrl(proxy_url)
  } else if (proxy_mode == "api") {
    try {
      const response = await axios.get(proxy_url)
      if (response.status == 200) {
        proxyAgent = parseProxyUrl(response.data)
      } else {
        proxyAgent = null
      }
    } catch (error) {
      proxyAgent = null
    }
  } else if (proxy_mode == "off") {
    proxyAgent = null
  }
  return proxyAgent
}


const sleep = async (ms) => {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

const isJson = (str) => {
  try {
    JSON.parse(str)
    return true
  } catch (error) {
    return false
  }
}
module.exports = {


  CreateRequest,
  ParseResponse,
  getProxyAgent
}

