# Data Page - Pesquisa Eleitoral Interna

Site para o cliente fazer uma pesquisa eleitoral interna nos próprios grupos (WhatsApp, Facebook,
Instagram, Telegram, X, TikTok…).

1. O cliente cria a conta com o **@ do Instagram** e uma senha.
2. Monta a pesquisa (até 5 perguntas, com os candidatos e as opções “Indeciso” e “Branco/Nulo”).
3. Recebe o **link** e os botões para enviar em cada rede. Cada botão marca de qual rede veio a resposta.
4. Quem participa escolhe responder **anônimo** ou **com o nome** (com autorização LGPD).
5. O painel mostra os percentuais, as respostas por rede social e por bairro, a lista de quem se
   identificou e permite baixar a planilha (CSV).

## Estrutura

- `frontend/` — site estático, publicado no GitHub Pages.
  - `index.html` — entrada (entrar / criar conta).
  - `painel.html` — painel do cliente: criar pesquisas, compartilhar e ver resultados.
  - `responder.html?p=CODIGO` — página pública que vai para os grupos.
- `backend/` — API Node.js (contas, pesquisas e votos), publicada no Render.

Na raiz do repositório: `render.yaml` (backend no Render) e `.github/workflows/pages.yml` (site no GitHub Pages).

## 1. Rodar no computador

```bash
cd backend
npm install
cp .env.example .env
npm start
```

Abra `frontend/index.html` no navegador (ou rode `python3 -m http.server` dentro de `frontend/`).
No computador o site usa automaticamente `http://localhost:3000`. Sem `DATABASE_URL`, os dados ficam em
`backend/data/db.json`.

## 2. Configurações

| Variável | Para que serve |
| --- | --- |
| `AUTH_SECRET` | Frase secreta que assina os logins. No Render é gerada sozinha. |
| `DATABASE_URL` | Banco Postgres. **Obrigatório em produção** (veja abaixo). |
| `FRONTEND_ORIGIN` | Endereço do site autorizado a usar a API (ex.: `https://usuario.github.io`). |
| `VOTE_LIMIT_PER_HOUR` | Máximo de respostas por conexão (IP) por hora. |

**Por que precisa de banco:** no plano gratuito do Render o disco é apagado a cada reinício, então as
pesquisas sumiriam. Crie um Postgres gratuito no [Neon](https://neon.tech) ou no
[Supabase](https://supabase.com) e cole o endereço de conexão em `DATABASE_URL`. As tabelas são criadas sozinhas.

## 3. Publicar

1. **Backend (Render):** *New → Blueprint* e selecione este repositório. Preencha `DATABASE_URL` e `FRONTEND_ORIGIN`.
2. **Frontend:** em `frontend/api.js`, troque `PRODUCTION_API_URL` pelo endereço do Render.
3. **GitHub Pages:** em *Settings → Pages*, em *Source* escolha **GitHub Actions**.

## Limites e cuidados

- **Um voto por aparelho**: o controle usa um código aleatório salvo no navegador. Quem limpar os dados
  do navegador ou usar outro aparelho consegue votar de novo. Serve para uso interno, não é à prova de fraude.
- **Login**: é feito com o @ do Instagram + senha criada no site. O site não confere se a pessoa é
  mesmo dona daquele Instagram (o login oficial da Meta exige conta comercial e aprovação do app).
- **Legislação eleitoral**: a ferramenta não é pesquisa registrada no TSE. Divulgar os resultados como
  pesquisa eleitoral sem registro é proibido (Lei 9.504/97, art. 33, e Res. TSE 23.600/2019), e enquetes
  sobre a eleição são vedadas no período de campanha. Use os números apenas internamente.
- **LGPD**: opinião política é dado pessoal sensível. O nome só é gravado quando a pessoa escolhe se
  identificar e marca a autorização.

## Ao alterar o site

Os arquivos `.js` e `.css` são carregados com `?v=NÚMERO` nos `.html`. Ao mudar qualquer um deles,
troque esse número nos três `.html` (`index`, `painel`, `responder`). Assim o navegador de quem já
visitou o site baixa a versão nova, em vez de usar a antiga guardada na memória.
