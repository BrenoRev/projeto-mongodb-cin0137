# Plataforma de Caronas Sustentáveis (MongoDB)

Projeto NoSQL da disciplina IF685 Gerenciamento de Dados e Informação (CIn/UFPE, 2026.2). O banco modela uma plataforma de caronas da Região Metropolitana do Recife: motoristas oferecem vagas, passageiros reservam assentos e cada viagem registra o CO2 economizado.

## Pré-requisitos

- Docker com Docker Compose. Não é preciso instalar MongoDB nem mongosh: tudo roda no container `mongo-caronas` (imagem `mongo:7`).

## Ambiente

```bash
# Subir o MongoDB (porta 27017, com scripts/ e tools/ montados no container)
docker compose up -d

# Conferir se o servidor executa JavaScript ($where, mapReduce e $function)
docker exec -i mongo-caronas mongosh --quiet --file /tools/teste_ambiente.js
```
