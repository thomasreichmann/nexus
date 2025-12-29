---
title: <% tp.date.now("YYYY-MM-DD") %>
created: <% tp.date.now("YYYY-MM-DD") %>
updated: <% tp.date.now("YYYY-MM-DD") %>
status: active
tags:
  - journal
  - daily
aliases:
  - <% tp.date.now("dddd, MMMM D, YYYY") %>
---

# <% tp.date.now("dddd, MMMM D, YYYY") %>

<< [[<% tp.date.now("YYYY-MM-DD", -1) %>|Yesterday]] | [[<% tp.date.now("YYYY-MM-DD", 1) %>|Tomorrow]] >>

## Focus

What's the main focus for today?

- <% tp.file.cursor() %>

## Progress

### Completed

-

### In Progress

-

### Blocked

-

## Notes

Learnings, discoveries, or things to remember.

## Decisions Made

Any decisions made today that should be documented.

## Tomorrow

What needs to happen next?

-
