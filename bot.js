const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(process.env.BOT_TOKEN);
const userSessions = new Map();

// 辅助函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Express 路由配置
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.status(200).send('OK'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// 开始命令
bot.command('start', (ctx) => {
  ctx.reply(`🚀 欢迎使用 Codex 绕过机器人!\n只需发送您的 Codex 链接即可开始绕过流程\n\n📡 状态: 运行正常`);
});

// 处理Codex链接
bot.hears(/(https?:\/\/[^\s]+)/, async (ctx) => {
  const url = ctx.message.text;
  
  // 从URL中提取ID
  const idRegex = /\/key\/([a-f0-9-]+)/i;
  const idMatch = url.match(idRegex);
  
  if (!idMatch || !idMatch[1]) {
    return ctx.reply('❌ 无法从链接中提取ID，请提供有效的Codex链接');
  }
  
  const sessionId = idMatch[1];
  await ctx.reply(`🔎 开始Codex绕过流程...\n提取的会话ID: \`${sessionId}\``, { parse_mode: 'Markdown' });
  
  // 创建用户会话
  userSessions.set(ctx.from.id, {
    sessionId,
    status: 'processing',
    stages: [],
    validatedTokens: [],
    lastActivity: Date.now()
  });
  
  const session = userSessions.get(ctx.from.id);
  
  try {
    // 获取阶段
    const stagesResponse = await axios.get('https://api.codex.lol/v1/stage/stages', {
      headers: { 'Android-Session': session.sessionId }
    });
    
    if (stagesResponse.data.success && stagesResponse.data.stages) {
      session.stages = stagesResponse.data.stages;
      session.status = 'processing_stages';
      await ctx.reply(`🔢 找到 ${session.stages.length} 个需要处理的阶段`);
      
      // 处理每个阶段
      for (let i = 0; i < session.stages.length; i++) {
        const stage = session.stages[i];
        await ctx.reply(`⏳ 处理阶段 ${i+1}/${session.stages.length}...`);
        
        // 初始化阶段
        const initiateResponse = await axios.post('https://api.codex.lol/v1/stage/initiate', {
          stageId: stage.uuid
        }, {
          headers: {
            'Android-Session': session.sessionId,
            'Content-Type': 'application/json'
          }
        });
        
        if (initiateResponse.data.success) {
          const token = initiateResponse.data.token;
          await sleep(6000); // 等待6秒
          
          // 基于token确定referrer
          const tokenData = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
          let referrer = 'https://linkvertise.com/';
          if (tokenData.link.includes('loot-links')) referrer = 'https://loot-links.com/';
          if (tokenData.link.includes('loot-link')) referrer = 'https://loot-link.com/';
          
          // 验证阶段
          const validateResponse = await axios.post('https://api.codex.lol/v1/stage/validate', {
            token
          }, {
            headers: {
              'Android-Session': session.sessionId,
              'Content-Type': 'application/json',
              'Task-Referrer': referrer
            }
          });
          
          if (validateResponse.data.success) {
            session.validatedTokens.push({
              uuid: stage.uuid,
              token: validateResponse.data.token
            });
            await ctx.reply(`✅ 阶段 ${i+1} 完成! (${stage.name})`);
          }
        }
        await sleep(1500); // 阶段间等待
        session.lastActivity = Date.now(); // 更新活动时间
      }
      
      // 所有阶段完成后进行认证
      const authResponse = await axios.post('https://api.codex.lol/v1/stage/authenticate', {
        tokens: session.validatedTokens
      }, {
        headers: {
          'Android-Session': session.sessionId,
          'Content-Type': 'application/json'
        }
      });
      
      if (authResponse.data.success) {
        await ctx.reply('🎉 绕过成功! 您现在可以访问Codex的高级功能。');
        userSessions.delete(ctx.from.id);
      }
    }
  } catch (error) {
    console.error(`处理错误: ${error.message}`);
    await ctx.reply(`❌ 处理错误: ${error.response?.data?.message || error.message}`);
  }
});

// 状态命令
bot.command('status', (ctx) => {
  if (userSessions.has(ctx.from.id)) {
    const session = userSessions.get(ctx.from.id);
    ctx.reply(`📊 当前状态: ${session.status}\n✅ 已完成阶段: ${session.validatedTokens.length}/${session.stages.length}`);
  } else {
    ctx.reply('❓ 没有活动的会话。发送您的Codex链接开始。');
  }
});

// 帮助命令
bot.command('help', (ctx) => {
  ctx.reply(`ℹ️ **Codex Bypass Bot 帮助**\n\n`
    + `/start - 开始使用机器人\n`
    + `/status - 查看当前绕过状态\n`
    + `/help - 显示此帮助信息\n\n`
    + `只需将您的Codex链接发送给我，我会自动处理绕过流程`, 
    { parse_mode: 'Markdown' }
  );
});

// 设置Webhook
bot.launch().then(() => {
  console.log('Bot started successfully');
});

// 每10分钟清理闲置会话
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of userSessions.entries()) {
    if (now - session.lastActivity > 30 * 60 * 1000) { // 30分钟无活动
      userSessions.delete(userId);
      console.log(`清理闲置会话: ${userId}`);
    }
  }
}, 10 * 60 * 1000); // 10分钟检查一次

// 优雅关闭
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
