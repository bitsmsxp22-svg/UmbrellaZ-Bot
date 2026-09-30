// PM2: mantém o app no ar 24/7 (reinicia se cair, se passar do limite de memória e após reboot com `pm2 startup`).
// Use 1 instância: a fila e os resultados ficam na memória do processo.
module.exports = {
  apps: [
    {
      name: 'logo-studio',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '800M',
      exp_backoff_restart_delay: 2000,
      kill_timeout: 12000,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
