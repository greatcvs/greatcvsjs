import fetch from 'node-fetch'
import fs from 'fs'
import plugin from '../../lib/plugins/plugin.js'
import { exec } from 'child_process'
import path from 'node:path'
import moment from 'moment'

/**
 * author : story-x
 * profile : https://github.com/story-x
 * repository-url : https://gitee.com/greatcvs/greatcvsjs
 * version : 1.0.0
 **/

// 填机器人QQ号
let BotUin = ''
// 要推送的群号
let GROUP_LIST = []
// 要推送的人
let USER_LIST = []
// 设置 GitHub令牌 （https://www.baidu.com/s?wd=GitHub令牌）
const GITHUB_TOKEN = ''
// 设置 Gitee令牌（https://www.baidu.com/s?wd=Gitee令牌）
const GITEE_TOKEN = ''
// 自定义仓库地址
const CUSTOM_REPOSITORY = [
  'https://github.com/yoimiya-kokomi/Miao-Yunzai'
]

const prefix = 'bubble:codeUpdateTask:'
let REPOSITORY_LIST = []
init()

export class CodeUpdateTask extends plugin {
  constructor () {
    super({
      name: '定时检查项目更新任务',
      dsc: 'codeUpdate',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '#测试代码推送$',
          permission: 'master',
          fnc: 'autoUpdatePush'
        }
      ]
    })
    this.task = {
      cron: '0 */10 * * * *', // Cron表达式，(秒 分 时 日 月 星期)
      name: '定时检查项目更新任务',
      fnc: () => this.autoUpdatePush()
    }
  }

  async sleep (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async autoUpdatePush (e) {
    if (!GITHUB_TOKEN || !GITEE_TOKEN) {
      logger.error('请先设置GitHub令牌或Gitee令牌')
      if (e?.msg) {
        e.reply('请先设置GitHub令牌或Gitee令牌')
      }
      return false
    }
    // 去重
    REPOSITORY_LIST = Array.from(new Set(REPOSITORY_LIST))
    if (REPOSITORY_LIST.length === 0) {
      logger.info('未检测到有效的仓库地址')
      return false
    }
    logger.info(`检测到${REPOSITORY_LIST.length}个仓库地址`)
    let content = []
    let index = -1
    for (const item of REPOSITORY_LIST) {
      logger.info(`仓库地址：${item.owner}/${item.repo}`)
      index++
      if (index > 1) {
        await this.sleep(1000)
      }
      let repositoryData
      if (item.source === 'Github') {
        repositoryData = await this.getGithubLatestCommit(item.owner, item.repo)
        if (!repositoryData?.sha) {
          logger.info(`Github仓库地址：${item.owner}/${item.repo}，未检测到提交记录`)
          repositoryData = await this.getGiteeLatestCommit(item.owner, item.repo)
          if (!repositoryData?.sha) {
            logger.info(`Gitee仓库地址：${item.owner}/${item.repo}，未检测到提交记录`)
            continue
          }
          logger.info(`Gitee仓库地址：${item.owner}/${item.repo}，最新提交：${repositoryData.date}`)
          // 替换REPOSITORY_LIST为gitee
          item.source = 'Gitee'
          REPOSITORY_LIST = REPOSITORY_LIST.map(i => {
            if (i.owner === item.owner && i.repo === item.repo) {
              i.source = 'Gitee'
            }
            return i
          })
        } else {
          logger.info(`Github仓库地址：${item.owner}/${item.repo}，最新提交：${repositoryData.date}`)
        }
      } else {
        repositoryData = await this.getGiteeLatestCommit(item.owner, item.repo)
        if (!repositoryData?.sha) {
          logger.info(`Gitee仓库地址：${item.owner}/${item.repo}，未检测到提交记录`)
          continue
        } else {
          logger.info(`Gitee仓库地址：${item.owner}/${item.repo}，最新提交：${repositoryData.date}`)
        }
      }
      if (!repositoryData?.sha) {
        logger.info(`仓库地址：${item.owner}/${item.repo}，未检测到提交记录`)
        continue
      }
      repositoryData.source = item.source
      const redisKey = `${prefix}${item.owner}/${item.repo}`
      let redisSha = await redis.get(redisKey)
      if (redisSha) {
        if (String(redisSha) === String(repositoryData.sha)) {
          logger.info(`仓库地址：${item.owner}/${item.repo} 暂无更新`)
          continue
        }
      }
      await redis.set(redisKey, repositoryData.sha)
      content.push(repositoryData)
    }

    if (content.length > 0) {
      const msg = '检测到项目更新...\n' + content.map(i => `项目名称：${i.owner}/${i.repo}\n冤种名称：${i.author}\n冤种邮箱：${i.email}\n更新信息：${i.message}\n更新时间：${i.date}\n数据来源：${i.source}\n`).join('\n')
      if (e?.msg) {
        e.reply(msg)
      } else {
        const bot = Bot[BotUin]
        if (USER_LIST && USER_LIST.length > 0) {
          for (const key of USER_LIST) {
            bot.pickUser(key).sendMsg(msg)
            await this.sleep(5000)
          }
        }
        if (GROUP_LIST && GROUP_LIST.length > 0) {
          for (const key of GROUP_LIST) {
            bot.pickGroup(key).sendMsg(msg)
            await this.sleep(10000)
          }
        }
      }
    }
  }

  async getGiteeLatestCommit (owner, repo) {
    const apiUrl = `https://gitee.com/api/v5/repos/${owner}/${repo}/commits`
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GITEE_TOKEN}`
    }
    try {
      const response = await fetch(apiUrl, { headers })
      const commits = await response.json()

      if (commits.length > 0) {
        const latestCommit = commits[0]
        return {
          owner,
          repo,
          sha: latestCommit.sha,
          author: latestCommit.commit.author.name,
          email: latestCommit.commit.author.email,
          date: moment(latestCommit.commit.author.date).format('YYYY-MM-DD HH:mm:ss'),
          message: latestCommit.commit.message.replace(/\n\s*$/, '')
        }
      } else {
        return '该仓库没有提交记录。'
      }
    } catch (error) {
      throw new Error('查询出错：' + error.message)
    }
  }

  async getGithubLatestCommit (owner, repo) {
    // 构建 API 请求的 URL
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits`
    // 设置请求头，包括认证信息
    const headers = {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    }

    try {
      // 发起 GET 请求获取最新的提交
      const response = await fetch(apiUrl, { headers })
      const commits = await response.json()

      if (commits.length > 0) {
        const latestCommit = commits[0]
        return {
          owner,
          repo,
          sha: latestCommit.sha,
          author: latestCommit.commit.author.name,
          email: latestCommit.commit.author.email,
          date: moment(latestCommit.commit.author.date).format('YYYY-MM-DD HH:mm:ss'),
          message: latestCommit.commit.message.replace(/\n\s*$/, '')
        }
      } else {
        return { error: '该仓库没有提交记录。' }
      }
    } catch (error) {
      return { error: '请求失败：' + error.message }
    }
  }
}

//

function init () {
  function gitRemoteUrl (remoteUrl) {
    const urlMatch = remoteUrl.match(/^(?:https?:\/\/)?(?:[^/]+\/)+([^/]+)\/([^/]+)(?:\.git)?$/)
    const sshUrlMatch = remoteUrl.match(/^.+@(.+):([^/]+)\/([^/]+)\.git$/)
    if (urlMatch) {
      // 判断是否是github
      const owner = urlMatch[1]
      const repo = urlMatch[2].replace('.git', '')
      REPOSITORY_LIST.push({
        source: 'Github',
        owner,
        repo
      })
    } else if (sshUrlMatch) {
      const owner = sshUrlMatch[2]
      const repo = sshUrlMatch[3]
      REPOSITORY_LIST.push({
        source: 'Github',
        owner,
        repo
      })
    }
  }

  // 遍历目录
  function traverseDirectory (currentPath) {
    const files = fs.readdirSync(currentPath)
    files.forEach(file => {
      const filePath = path.join(currentPath, file)
      const stat = fs.statSync(filePath)

      if (stat.isDirectory()) {
        if (file === '.git') {
          const gitConfigPath = path.join(filePath, 'config')

          exec(`git config --file ${gitConfigPath} --get remote.origin.url`, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
              logger.error(`Error executing command for Git config file: ${gitConfigPath}`)
              logger.error(error)
              return
            }

            const remoteUrl = stdout.trim()
            if (remoteUrl) {
              gitRemoteUrl(remoteUrl)
            }
          })
        } else {
          traverseDirectory(filePath)
        }
      }
    })
  }

  // 处理自定义地址
  if (CUSTOM_REPOSITORY.length > 0) {
    CUSTOM_REPOSITORY.forEach(item => {
      gitRemoteUrl(item)
    })
  }
  // 遍历目录
  traverseDirectory('.\\plugins')
  logger.info('开始遍历目录: plugins')
}
