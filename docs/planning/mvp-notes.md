---
title: MVP Planning Notes
created: 2025-12-29
updated: 2025-12-29
status: active
tags:
  - planning
  - mvp
  - decision
aliases:
  - Initial Planning Notes
---

# MVP Planning Notes

Initial architecture considerations and decisions for the Nexus MVP.

## Background

A Proof of Concept was previously built that successfully demonstrated:
- File upload capability
- AWS S3 cold storage retrieval functionality

The POC proved the concept is viable and feasible. However, it should NOT be used as a technical reference for the MVP - we're starting fresh with proper architecture.

## Architecture Considerations

### Storage Strategy

**Key Questions:**
- When to use AWS S3 Standard vs S3 Deep Storage/Glacier?
- What are the access patterns and retrieval time requirements?
- Cost optimization strategy between storage tiers

**Initial Approach:**
- AI-assisted development for front-end
- Supabase as potential all-in-one solution for backend

### Technology Stack

See [[tech-stack|Tech Stack]] for final decisions.

**Considerations that led to decisions:**
- Ship-first methodology
- Modern framework with good DX
- All-in-one backend platform
- Type-safe ORM

### Authentication & User Management

**Requirements:**
- User authentication system
- Session management
- Permission/access control

**Decision:** Supabase Auth (integrated, with flexibility to switch)

### Payment & Billing

**Initial Plan:**
- Stripe for payment processing
- Start with monthly subscription model
- Generous usage limits
- Keep it simple initially

**Future Considerations:**
- Could migrate to other payment providers
- Might switch to usage-based pricing model
- Need better cost control as we scale

### Database & Storage Architecture

**Core Requirements:**
- Postgres database (via Supabase)
- Real-time capabilities for live updates
- Scalable storage solution

**Technical Notes:**
- Research S3 Glacier pricing and retrieval costs in detail
- Plan storage tier transition logic
- Consider lifecycle policies for automatic archiving

**Flexibility Built In:**
- Auth system can be swapped if needed
- Database could migrate to DynamoDB or other solutions
- Storage architecture should support multiple providers

## Core Development Principles

### 1. Keep It Simple

This should be a simple "poster" project:
- Don't over-engineer
- Focus on core functionality first
- Clean, understandable codebase

### 2. Build for Flexibility

- All infrastructure components should be swappable
- Don't lock into specific vendors
- Plan migration paths from day one
- Use abstractions where appropriate

### 3. Production-Ready from Start

Unlike the POC, build this right:
- Proper error handling
- Monitoring and logging
- Security best practices

## Open Questions

### Technical Decisions
- Which AI development tool should we standardize on?
- Final frontend framework choice?
- Should we go all-in on Supabase or build more modularly?

### Business/Product Decisions
- Subscription-based vs usage-based pricing for launch?
- What are the initial pricing tiers?
- What's included in the free tier (if any)?

### Infrastructure Decisions
- When exactly do files transition from Standard to Deep Storage?
- What's the retrieval SLA we're committing to?
- Which cloud region(s) to deploy to initially?

## Related

- [[roadmap|Project Roadmap]]
- [[tech-stack|Tech Stack]]
- [[principles|Design Principles]]
- [[planning/_index|Back to Planning]]
