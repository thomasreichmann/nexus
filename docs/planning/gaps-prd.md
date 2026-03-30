# Gaps: Nexus vs PRD CloudVault

Análise do que falta implementar no Nexus comparando com o PRD completo. Organizado por fase (MVP → v1.5 → v2.0) e com indicação do que já existe.

---

## Legenda

- ✅ Implementado
- 🔧 Parcialmente implementado
- ❌ Não existe

---

## 1. Storage & Infraestrutura

| Feature                                                | Status | Fase | Notas                                                                  |
| ------------------------------------------------------ | ------ | ---- | ---------------------------------------------------------------------- |
| AWS S3 com tiers (Standard, Glacier, Deep Archive)     | ✅     | —    | Funcionando com lifecycle                                              |
| Upload presigned + multipart chunked                   | ✅     | —    | Com ETags e retry                                                      |
| Retrieval com status tracking                          | ✅     | —    | pending → ready → expired                                              |
| Cloudflare R2 como tier quente (thumbnails, previews)  | ❌     | MVP  | PRD recomenda R2 pra egress zero e latência no Brasil                  |
| Backblaze B2 como tier frio                            | ❌     | MVP  | PRD recomenda B2 a $6/TB vs S3 Standard a $23/TB                       |
| Lifecycle automático entre 3 tiers (R2 → B2 → Glacier) | ❌     | MVP  | Hoje só usa S3; PRD pede movimentação automática invisível pro usuário |
| Geração de thumbnails (Sharp)                          | ❌     | MVP  | Previews de fotos incluindo RAW (CR3, ARW, NEF, RAF, DNG)              |
| Geração de previews de vídeo (FFmpeg)                  | ❌     | MVP  | Thumbnail do primeiro frame + preview 30s em baixa resolução           |
| Verificação de integridade via SHA-256 checksums       | ❌     | MVP  | Upload com checksum pra garantir integridade                           |
| CDN via Cloudflare pra previews/thumbnails             | ❌     | MVP  | Edge nodes no Brasil pra latência aceitável                            |
| Download em lote (ZIP server-side)                     | ❌     | MVP  | Geração de ZIP no servidor pra múltiplos arquivos                      |
| Deduplicação inteligente                               | ❌     | v2.0 | Detectar duplicados e oferecer limpeza                                 |
| Relatórios periódicos de integridade de checksums      | ❌     | v2.0 | Email mensal confirmando integridade do acervo                         |

---

## 2. Upload & Sync

| Feature                                        | Status | Fase  | Notas                                                            |
| ---------------------------------------------- | ------ | ----- | ---------------------------------------------------------------- |
| Upload via browser (drag & drop)               | ✅     | —     | Upload zone no dashboard                                         |
| Upload pausável e resumível                    | 🔧     | MVP   | Multipart existe mas sem pause/resume explícito na UI            |
| Controle de bandwidth no upload                | ❌     | MVP   | Importante pra internet brasileira instável                      |
| App desktop (Tauri) com monitoramento de pasta | ❌     | MVP   | Auto-upload quando novos arquivos aparecem na pasta do Lightroom |
| Upload automático com fila e retry             | 🔧     | MVP   | Retry existe no backend; falta no client desktop                 |
| Plugin Lightroom Classic (Publish Service)     | ❌     | v1.5  | Killer feature — elimina atrito de upload                        |
| Upload via API pública                         | ❌     | v2.0  | Pra integrações de terceiros                                     |
| Plugin Capture One                             | ❌     | v2.0  | Market share significativo entre fotógrafos profissionais        |
| Plugin DaVinci Resolve                         | ❌     | v2.0  | Padrão pra videomakers fora do Premiere                          |
| Camera-to-Cloud (Frame.io partnerships)        | ❌     | v2.0+ | Canon, Sony, Fujifilm, Nikon                                     |

---

## 3. Organização & Busca

| Feature                                                | Status | Fase | Notas                                                     |
| ------------------------------------------------------ | ------ | ---- | --------------------------------------------------------- |
| Listagem de arquivos com ações                         | ✅     | —    | File browser no dashboard                                 |
| Organização por Projetos (ex: "Casamento Ana & Pedro") | ❌     | MVP  | Unidade básica de organização do PRD                      |
| Preservação da estrutura de pastas original            | ❌     | MVP  | Manter hierarquia de pastas do upload                     |
| Extração automática de metadados EXIF                  | ❌     | MVP  | Câmera, lente, data, GPS                                  |
| Tags manuais                                           | ❌     | MVP  | Organização livre por tags                                |
| Indicação visual de tier por arquivo                   | ❌     | MVP  | Mostrar em qual tier está + tempo estimado de recuperação |
| Busca por metadados                                    | ❌     | MVP  | Buscar por câmera, data, lente, etc.                      |
| Busca por IA (auto-tagging com visão)                  | ❌     | v1.5 | "vestido branco", "pôr do sol" — CLIP ou Claude Vision    |
| Reconhecimento facial e agrupamento                    | ❌     | v2.0 | "todas as fotos da noiva" — requer LGPD consent flow      |
| Smart albums                                           | ❌     | v2.0 | Álbuns automáticos baseados em critérios                  |
| Cross-archive search                                   | ❌     | v2.0 | Busca unificada no acervo inteiro                         |

---

## 4. Autenticação & Usuários

| Feature                                         | Status | Fase | Notas                                 |
| ----------------------------------------------- | ------ | ---- | ------------------------------------- |
| Email/senha                                     | ✅     | —    | BetterAuth implementado               |
| Google OAuth                                    | ❌     | MVP  | PRD pede Google + Apple               |
| Apple OAuth                                     | ❌     | MVP  | Importante pra ecossistema Apple      |
| Multi-usuário com roles (admin, editor, viewer) | ❌     | v2.0 | Plano Studio — até 5 membros          |
| Pastas privadas e compartilhadas por membro     | ❌     | v2.0 | Dashboard do admin com uso por membro |
| Convite de membros da equipe                    | ❌     | v2.0 | Sistema de convites com roles         |

---

## 5. Pagamento & Localização Brasil

| Feature                                | Status | Fase | Notas                                                       |
| -------------------------------------- | ------ | ---- | ----------------------------------------------------------- |
| Stripe subscriptions                   | ✅     | —    | Planos starter/pro/max/enterprise                           |
| PIX via Stripe Brazil                  | ❌     | MVP  | 0.33% merchant fee vs 2–5% cartão — sem PIX = 68%+ abandono |
| Boleto bancário                        | ❌     | MVP  | Método de pagamento essencial no Brasil                     |
| Parcelamento em até 12x no cartão      | ❌     | MVP  | Padrão brasileiro                                           |
| Pricing em BRL                         | ❌     | MVP  | R$29/69/149 conforme PRD                                    |
| Desconto de 20% no plano anual         | ❌     | MVP  | Anual como opção com desconto                               |
| Trial de 14 dias sem cartão            | ❌     | MVP  | Plano Pro sem pedir cartão                                  |
| Storage adicional por TB (R$25/TB/mês) | ❌     | MVP  | Add-on em qualquer plano pago                               |
| Pricing USD pra mercado global         | ❌     | v2.0 | $9/$19/$39 — fase de expansão                               |

---

## 6. Compartilhamento & Entrega

| Feature                                                    | Status | Fase  | Notas                                     |
| ---------------------------------------------------------- | ------ | ----- | ----------------------------------------- |
| Compartilhamento temporário com link                       | ❌     | v1.5  | Com expiração e senha                     |
| Substituir WeTransfer/Google Drive pra entregas            | ❌     | v1.5  | Entrega de arquivos grandes a clientes    |
| Galerias com watermark (plano Free)                        | ❌     | v1.5  | Free tier com watermark                   |
| Print sales / integração com labs                          | ❌     | v2.0+ | Transformar plataforma em revenue center  |
| Marketing automatizado (carrinho abandonado, aniversários) | ❌     | v2.0+ | Campanhas que geram receita pro fotógrafo |

---

## 7. Mobile

| Feature                   | Status | Fase | Notas                                            |
| ------------------------- | ------ | ---- | ------------------------------------------------ |
| App mobile (PWA primeiro) | ❌     | v1.5 | Visualizar acervo, buscar, solicitar recuperação |
| Push notifications        | ❌     | v1.5 | Upload completo, recuperação pronta              |
| App nativo (React Native) | ❌     | v2.0 | Após validar PWA                                 |
| Upload mobile             | ❌     | v2.0 | Não no v1.5 — vem depois                         |

---

## 8. Dashboard & UX

| Feature                        | Status | Fase | Notas                                  |
| ------------------------------ | ------ | ---- | -------------------------------------- |
| Dashboard com uso de storage   | ✅     | —    | StorageUsageBar + StorageByType        |
| Upload history                 | ✅     | —    | UploadHistory component                |
| Distribuição entre tiers       | ✅     | —    | StorageByType com recharts             |
| Projeção de custo pro usuário  | ❌     | MVP  | "Quanto vou gastar nos próximos meses" |
| Interface em português (pt-BR) | ❌     | MVP  | PRD: Portuguese-first UX               |
| Internacionalização (i18n)     | ❌     | MVP  | Suporte a pt-BR e en-US                |
| Dark/light mode                | ✅     | —    | Theme provider implementado            |

---

## 9. Landing Page & Marketing

| Feature                                      | Status | Fase | Notas                        |
| -------------------------------------------- | ------ | ---- | ---------------------------- |
| Landing page com hero, features, pricing     | ✅     | —    | Componentes implementados    |
| Waitlist na landing page                     | ❌     | MVP  | Captura de emails pré-launch |
| Pricing em BRL na landing                    | ❌     | MVP  | R$0/29/69/149 conforme PRD   |
| Referral program (1 mês grátis + 50GB extra) | ❌     | v1.5 | Fotógrafos indicam entre si  |
| Landing page em inglês (expansão US)         | ❌     | v2.0 | Fase de internacionalização  |
| Integração com Alboom (API sync)             | ❌     | v2.0 | Complementar, não competir   |

---

## 10. Compliance & Segurança

| Feature                                    | Status | Fase | Notas                                             |
| ------------------------------------------ | ------ | ---- | ------------------------------------------------- |
| Webhook events audit log                   | ✅     | —    | Tabela webhookEvents                              |
| LGPD — consent flow pra facial recognition | ❌     | v2.0 | Opt-in explícito + DPIA documentado               |
| LGPD — SCCs pra transferência cross-border | ❌     | MVP  | Dados armazenados fora do Brasil precisam de SCCs |
| Política de privacidade / termos de uso    | ❌     | MVP  | Obrigatório pra launch                            |
| Data Protection Impact Assessment (DPIA)   | ❌     | v2.0 | Antes de lançar reconhecimento facial             |

---

## 11. Infraestrutura & DevOps

| Feature                                 | Status | Fase | Notas                                       |
| --------------------------------------- | ------ | ---- | ------------------------------------------- |
| Terraform IaC                           | ✅     | —    | Diretório infra/terraform existe            |
| CI/CD (GitHub Actions)                  | ✅     | —    | pr-check, ci, post-merge                    |
| Lambda worker pra jobs async            | ✅     | —    | SQS + handler registry                      |
| Workers pra processamento de thumbnails | ❌     | MVP  | Sharp + FFmpeg em serverless ou fila BullMQ |
| Abstração multi-provider S3-compatible  | ❌     | MVP  | Trocar entre R2/B2/S3 sem afetar usuário    |
| Monitoramento de custos por provider    | ❌     | v1.5 | Tracking de quanto gasta em cada tier       |
| Alertas de anomalia de uso              | ❌     | v2.0 | Detectar uploads/downloads anormais         |

---

## 12. Testes

| Feature                         | Status | Fase | Notas                                             |
| ------------------------------- | ------ | ---- | ------------------------------------------------- |
| Unit tests (Vitest)             | ✅     | —    | 31 test files                                     |
| E2E tests (Playwright)          | ✅     | —    | Smoke + admin flows                               |
| Integration tests S3            | ✅     | —    | Webhook integration tests                         |
| Testes do app desktop (Tauri)   | ❌     | MVP  | Quando o app desktop existir                      |
| Load testing de upload          | ❌     | MVP  | Simular uploads concorrentes pesados              |
| Testes de lifecycle entre tiers | ❌     | MVP  | Validar movimentação automática R2 → B2 → Glacier |

---

## Resumo por fase

### MVP (Meses 1–6) — 35 itens faltando

**Prioridade crítica:**

1. Geração de thumbnails/previews (Sharp + FFmpeg)
2. Organização por Projetos com estrutura de pastas
3. PIX + Boleto + Parcelamento via Stripe Brazil
4. Pricing em BRL (R$0/29/69/149)
5. App desktop Tauri com auto-upload
6. Cloudflare R2 como tier quente + CDN
7. Interface em português (i18n pt-BR)
8. Trial de 14 dias sem cartão
9. Google/Apple OAuth

**Prioridade alta:** 10. Backblaze B2 como tier frio 11. Lifecycle automático entre 3 tiers 12. Extração de metadados EXIF 13. Preview de RAW files no browser 14. Upload pausável/resumível na UI 15. Projeção de custo no dashboard 16. SCCs pra LGPD (transferência cross-border) 17. Termos de uso e política de privacidade 18. Waitlist na landing page

### v1.5 (Meses 7–9) — 10 itens

1. Plugin Lightroom Classic
2. Busca por IA (auto-tagging)
3. Compartilhamento temporário com expiração/senha
4. App mobile (PWA)
5. Push notifications
6. Referral program
7. Galerias com watermark (free tier)
8. Monitoramento de custos por provider

### v2.0 (Meses 10–12) — 16 itens

1. Reconhecimento facial + LGPD consent flow
2. Multi-usuário com roles (Studio)
3. Deduplicação inteligente
4. Relatórios de integridade
5. Plugin Capture One + DaVinci Resolve
6. App nativo React Native
7. Smart albums
8. Cross-archive search
9. Integração Alboom (API)
10. Landing page em inglês
11. Pricing USD
12. Print sales
13. Marketing automatizado
14. Upload via API pública
15. DPIA documentado
16. Alertas de anomalia
