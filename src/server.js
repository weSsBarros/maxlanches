import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app, db, events, generatedPassword } = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`Max Lanches rodando em http://localhost:${config.port}`);
  console.log(`Painel administrativo: http://localhost:${config.port}/admin`);
  if (generatedPassword) {
    console.log('\n==================================================================');
    console.log(` Primeiro acesso: usuário "${config.adminUser}", senha "${generatedPassword}"`);
    console.log(' Troque a senha em Configurações assim que entrar.');
    console.log('==================================================================\n');
  }
});

function shutdown() {
  events.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
