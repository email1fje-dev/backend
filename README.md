# NPC IRL Backend

Backend API for NPC IRL: an AI-generated real-life quest game.

## Stack
- Node.js + Fastify
- PostgreSQL (Railway)
- OpenRouter Free model for quest generation and proof verification
- Photo/screenshot proof is checked by a vision-capable OpenRouter model

## Environment variables
- DATABASE_URL
- OPENROUTER_API_KEY
- OPENROUTER_MODEL (default: google/gemma-3-27b-it:free)
- PORT

## API
- GET /health
- POST /api/users
- GET /api/users/:id
- GET /api/users/:id/quests
- POST /api/users/:userId/quests/:questId/proof
- GET /api/users/:id/achievements

The app generates quests automatically. Users never create quests.

## Railway
Connect this GitHub repository to a Railway service. Railway can deploy directly from GitHub and automatically redeploy when the connected branch receives a new commit. Add a PostgreSQL service and provide its DATABASE_URL to the backend, plus OPENROUTER_API_KEY. Generate a public domain for the API service.

Never commit real API keys to this repository.
