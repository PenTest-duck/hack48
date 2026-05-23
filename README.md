This repo is structured as a small monorepo:

- `web/` contains the Next.js app
- `ios/` is reserved for the future iOS app

## Getting Started

Install dependencies for the web app:

```bash
cd web
npm install
```

Then run the development server:

```bash
cd web
npm run dev
```

The `web` app's `dev` script is workspace-aware when used inside Conductor:

- It reuses a shared `.env.local` from the workspace group's `.shared` directory when available.
- It assigns each workspace a stable localhost port and stores that mapping in `.shared/workspace-ports.json`.
- It prints the exact URL it chose before starting Next.js.

If you need plain Next.js behavior, run:

```bash
cd web
npm run dev:next
```

Open the printed `http://localhost:<port>` URL with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
