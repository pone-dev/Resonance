# Run Resonance in GitHub Codespaces

1. Extract the project ZIP and upload/push the **contents** to the root of a new GitHub repository.
2. Open the repository on GitHub.
3. Choose **Code → Codespaces → Create codespace on main**.
4. Wait for the Dev Container to finish. It installs dependencies and starts a private MongoDB service.
5. In the Codespaces terminal, run:

   ```bash
   npm run dev
   ```

6. Open port **5173** from the **Ports** tab. That is the Resonance web app.
7. Optional API health check: open forwarded port **8080** and visit `/api/health`.

The development command runs the web and API servers together. Stop them with `Ctrl+C`.

## Enable OpenAI features

Create `.env` in the repository root:

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`, replace the sample `ACCESS_PASSWORD` and `TOKEN_SECRET` values with your own values, then restart the dev servers. Use the `ACCESS_PASSWORD` value to unlock the studio. The Codespaces container supplies `MONGODB_URI=mongodb://mongo:27017/resonance`; this environment variable takes precedence over the localhost value in `.env.example`.

## Git commands

```bash
git add .
git commit -m "Set up Resonance audio studio"
git push
```

Keep Codespaces ports private unless you intentionally want to expose the app. Configure real authentication, production secrets, managed database and persistent storage before a public deployment. Never commit `.env` or provider API keys.
