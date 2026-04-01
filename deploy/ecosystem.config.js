module.exports = {
  apps: [{
    name: 'deploy',
    script: 'index.js',
    env_file: '.env',
    watch: false,
    autorestart: true,
    out_file: '/opt/jscraft/logs/deploy.log',
    error_file: '/opt/jscraft/logs/deploy.error.log',
  }]
};
