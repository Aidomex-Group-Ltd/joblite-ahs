#!/bin/bash
echo "Joblite AHS Setup"
echo "=================="
npm install
npm run build
echo "Build complete. Run 'npm run dev' to start development server."
echo "Apply migrations with: npx wrangler d1 migrations apply joblite-db --local"
