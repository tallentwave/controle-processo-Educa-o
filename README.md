# Controle de Processos – Secretaria Municipal de Educação

Sistema web para registrar, acompanhar e controlar prazos de processos da Secretaria Municipal de Educação.

## Recursos
- **Perfis**: *Administrador* (cria/edita/desativa usuários, redefine senhas, configura o sistema, exclui processos, vê a auditoria) e *Usuário* (criado pelo administrador).
- **Primeiro acesso seguro**: senhas provisórias, troca obrigatória no primeiro login, senhas com hash `scrypt`, bloqueio temporário após 5 tentativas erradas.
- **Processos**: número do processo informado manualmente (número do sistema 1Doc, único), tipo, prioridade, interessado, origem, responsável, prazo, situação e histórico de andamentos (linha do tempo).
- **Controle de prazos com alerta**: painel com vencidos / vencem hoje / próximos N dias, faixa de aviso, central de alertas (cada usuário vê os seus; o admin vê todos), cores nas listas e contador no menu. A antecedência (N) é configurável.
- **Painel** com indicadores, carga por responsável e últimas movimentações.
- Busca e filtros, exportação **CSV** (Excel), impressão, **auditoria** de ações, layout responsivo (celular).

## Como executar
Requer Node.js ≥ 22.13 (sem dependências externas; usa o SQLite embutido do Node).

```bash
npm start            # http://localhost:3000
PORT=8080 npm start  # outra porta
npm test             # testes de API
```

Primeiro acesso: login `admin`, senha `admin123` (ou a definida em `ADMIN_PASSWORD` antes da primeira execução). O sistema exige a troca imediata.

Os dados ficam em `data/processos.db` (altere com `DATA_DIR`). **Faça backup periódico dessa pasta.**

## Produção
Publique atrás de HTTPS (ex.: nginx/Caddy como proxy reverso). Em HTTPS, considere adicionar o atributo `Secure` ao cookie de sessão em `server.js`.

## Instalação em VPS (Ubuntu/Debian)
Como root no servidor: `DOMINIO=processos.seudominio.gov.br bash deploy/instalar.sh` (sem `DOMINIO` o acesso é por `http://IP:3000`).
O script instala Node 22, cria o serviço `processos`, HTTPS automático (Caddy), backup diário em `/var/backups/processos` e o comando `processos-atualizar`.

## Versão PHP + MySQL com instalador pelo navegador (hospedagem compartilhada)
Para hospedagens sem Node.js (ex.: planos compartilhados), use o pacote `dist/controle-processos-php.zip` (gerado por `php/build.sh`):
1. Crie um banco MySQL e um usuário no painel da hospedagem.
2. Envie e extraia o zip na `public_html` (confira que o `.htaccess` foi extraído).
3. Abra `https://seu-dominio/install.php`, informe os dados do banco e do administrador. O instalador cria as tabelas e se apaga sozinho.

Requisitos: PHP 8.0+ com `pdo_mysql` e `mbstring`. A interface e as regras são as mesmas da versão Node; `npm test` valida as duas (a PHP com SQLite; com `PHP_TEST_MYSQL=1`, contra um MySQL/MariaDB local).
