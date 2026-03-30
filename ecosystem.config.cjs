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
        NEXT_PUBLIC_YJS_WEBSOCKET_SERVER:
          process.env.NEXT_PUBLIC_YJS_WEBSOCKET_SERVER || "ws://127.0.0.1:1234",
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
        HOST: "0.0.0.0",
        PORT: process.env.YJS_PORT || "1234",
      },
      autorestart: true,
      max_memory_restart: "300M",
      time: true,
    },
  ],
};
