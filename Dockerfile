FROM node:20-alpine

WORKDIR /app

# Instala dependências primeiro (cache de camadas)
COPY package.json ./
RUN npm install --omit=dev

# Copia o restante do projeto
COPY . .

# Cria pastas necessárias
RUN mkdir -p data public/uploads

# Usuário não-root para segurança
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
  && chown -R appuser:appgroup /app
USER appuser

EXPOSE 8909

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8909 || exit 1

CMD ["node", "server.js"]
