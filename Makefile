.PHONY: help install test test-coverage test-frontend test-e2e demo-offline seed status serve mobile-test ci-local clean

help:
	@grep -E "^[a-zA-Z_-]+:.*?## .*$$" $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install Node dependencies (clean, lockfile-exact)
	npm ci

test: ## Backend unit + functional + negative (no coverage gate)
	npm test

test-coverage: ## Backend tests with 100% coverage gate
	npm run test:coverage

test-frontend: ## Web jsdom E2E (executes locally)
	npm run test:frontend

test-e2e: ## Playwright web-desktop + web-mobile (needs browser binary)
	npm run test:e2e

mobile-test: ## Flutter unit + widget tests (needs Flutter SDK)
	cd mobile && flutter pub get && flutter test

demo-offline: ## Full Golden Thread, no network — prints the moat proof
	npm run demo-offline

seed: ## Generate deterministic synthetic data + manifest
	npm run seed

status: ## System health / control / connector report
	npm run status

serve: ## Serve the web control room on :4173
	node --import tsx scripts/serve.ts

ci-local: install ## Run everything that can run without browser/Flutter binaries
	npx tsc -p tsconfig.json
	npm run test:coverage
	npm run test:frontend
	npm run demo-offline

clean: ## Remove build/coverage/report artifacts
	rm -rf node_modules coverage dist playwright-report test-results mobile/.dart_tool mobile/build
