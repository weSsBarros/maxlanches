# Max Lanches — site, cardápio online e painel de gestão

Sistema completo para o food truck **Max Lanches**: o cliente monta o pedido pelo celular e a loja
acompanha tudo em tempo real num painel, com controle do cardápio e relatórios de vendas e lucro.

## O que tem

**Site do cliente** (`/`)
- Cardápio por categoria (churrasquinhos, hambúrgueres, cachorros-quentes, bebidas…) com foto, descrição e preço.
- Itens esgotados aparecem acinzentados; aviso de "últimas unidades" quando o estoque está baixo.
- Carrinho com **observação por item** ("sem cebola", "bem passado") e **observação geral** do pedido.
- Entrega ou retirada no food truck; **taxa de entrega por bairro**, pedido mínimo e entrega grátis acima de um valor.
- Pagamento: Pix, dinheiro (com troco) ou cartão na maquininha.
- **Pix copia e cola com o valor exato** do pedido (sem integração bancária, sem taxa).
- Página de acompanhamento do pedido (`/pedido/CÓDIGO`) que atualiza sozinha, com botão para enviar o pedido no WhatsApp da loja.
- Carrinho e dados do cliente ficam salvos no celular para o próximo pedido.

**Painel do lojista** (`/admin`)
- **Pedidos em tempo real** com alerta sonoro, colunas Novos → Em preparo → Prontos/a caminho, impressão de comanda (bobina 80 mm) e atalho para falar com o cliente no WhatsApp.
- Botão **Abrir/Fechar loja**.
- **Cardápio**: criar/editar produtos e categorias, foto (reduzida automaticamente), preço, **custo**, interruptor de disponível/esgotado e **estoque opcional** (esgota sozinho ao zerar e volta ao cancelar pedido).
- **Entrega**: bairros e taxas, pedido mínimo, entrega grátis, tempo estimado.
- **Relatórios** por período: faturamento, número de pedidos, **lucro bruto e margem**, ticket médio, mais vendidos, pedidos por horário, formas de pagamento, entregas por bairro e **exportação para planilha (CSV/Excel)**.
- Configurações da loja (nome, WhatsApp, Instagram, endereço, horário), Pix e troca de senha.

## Tecnologia

- **Node.js 22+**, Express e **SQLite** (arquivo único, sem servidor de banco para manter).
- Front-end em HTML, CSS e JavaScript puros — sem etapa de build.
- Pedidos em tempo real via Server-Sent Events.
- Dinheiro sempre guardado em centavos; preço, custo e taxa são calculados no servidor (o navegador não consegue alterar valores).
- Cada item do pedido guarda o preço e o custo do momento da venda, então mudar o preço depois não altera relatórios antigos.

## Rodando no computador

```bash
npm install
cp .env.example .env      # ajuste ADMIN_PASSWORD
npm run dev               # http://localhost:3000  e  http://localhost:3000/admin
```

Na primeira execução é criado um cardápio de exemplo (desative com `SEED_DEMO_DATA=false`).
Se `ADMIN_PASSWORD` estiver vazio, uma senha aleatória aparece no terminal.

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm test` | Roda os testes automatizados |
| `npm run backup` | Cópia de segurança do banco em `data/backups/` (guarda as 30 últimas) |
| `DATA_DIR=./data-demo npm run demo -- 30` | Gera 30 dias de pedidos fictícios num banco separado, para ver os relatórios |

## Colocando no ar

O app precisa de um servidor com **disco persistente** (o banco e as fotos ficam em `DATA_DIR`) e **HTTPS**.

**Opção recomendada — VPS com Docker** (ex.: Hostinger, Contabo, DigitalOcean; a partir de ~R$ 25/mês):

1. Aponte o domínio para o IP do servidor.
2. Troque o domínio no `Caddyfile` e crie o `.env` a partir do `.env.example`.
3. `docker compose up -d` — o Caddy emite o certificado HTTPS sozinho.
4. Agende o backup diário, por exemplo no `crontab`:
   `0 5 * * * cd /caminho/maxlanches && docker compose exec -T app npm run backup`

> O `Dockerfile` e o `docker-compose.yml` ainda não foram testados num servidor real — valide na primeira instalação.

**Alternativas**: Railway ou Render (com volume persistente montado em `DATA_DIR`). Evite planos sem disco
persistente: o banco seria apagado a cada deploy.

## Estrutura

```
src/
  server.js, app.js, config.js
  db/            migrações e cardápio de exemplo
  lib/           autenticação, Pix, datas, eventos em tempo real, validação
  routes/        API pública (/api) e do painel (/api/admin)
  services/      regras de cardápio, pedidos, relatórios e configurações
public/
  index.html     site e cardápio          js/site/
  pedido.html    acompanhamento do pedido
  admin/         painel do lojista        js/admin/
scripts/         backup e dados de demonstração
tests/           testes da API e das regras
```

## Segurança

- Senhas com scrypt; sessão em cookie `HttpOnly`/`SameSite=Lax` (e `Secure` em produção).
- Bloqueio de requisições de escrita vindas de outros sites e limite de tentativas de login e de pedidos por IP.
- Content-Security-Policy restritiva; tudo o que vem do usuário é escapado antes de aparecer na tela.
- O link de acompanhamento usa um código aleatório, e não o número sequencial do pedido.
