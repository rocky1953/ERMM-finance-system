module.exports = {
  apps: [{
    name: 'ermm-finance',
    script: './app.js',
    env_production: { 
      NODE_ENV: 'production', 
      PORT: 3008 
    },
    instances: '1',
    exec_mode: 'fork',
    max_memory_restart: '512M',
    error_file: './logs/err.log',
    out_file: './logs/out.log'
  }]
};
