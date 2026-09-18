module.exports = {
  apps: [
    {
      name: 'paid-access-bot',
      script: 'src/bot.js',
      watch: false,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
