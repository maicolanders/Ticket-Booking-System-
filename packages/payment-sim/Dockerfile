FROM node:22.22.0-alpine3.22
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/functions/package.json packages/functions/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/payment-sim/package.json packages/payment-sim/package.json
COPY packages/acceptance/package.json packages/acceptance/package.json
RUN npm ci --workspace @ticket/payment-sim --include-workspace-root --registry=https://registry.npmjs.org
COPY packages/payment-sim packages/payment-sim
EXPOSE 4100
CMD ["npm", "run", "start", "-w", "@ticket/payment-sim"]
