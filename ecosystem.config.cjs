const appDirectory = process.env.APP_DIRECTORY || __dirname;

module.exports = {
  apps: [
    {
      name: "monopoly-web",
      cwd: appDirectory,
      script: "npm",
      args: "run start -- --port 3000",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_memory_restart: "500M",
      time: true,
    },
    {
      name: "monopoly-realtime",
      cwd: appDirectory,
      script: "npm",
      args: "run realtime:server",
      env: {
        HOST: "127.0.0.1",
        PORT: process.env.YJS_PORT || "1234",
      },
      autorestart: true,
      max_memory_restart: "300M",
      time: true,
    },
  ],
};
