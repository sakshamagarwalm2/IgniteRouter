# IgniteRouter

IgniteRouter is a fork of [ClawRouter](https://github.com/BlockRunAI/ClawRouter) - an open-source smart LLM router built for autonomous AI agents.

## Upstream Sync Instructions

This repo is a fork of ClawRouter. To sync with upstream:

### 1. Fetch Latest Changes
```bash
git fetch upstream
```

### 2. Merge Upstream Main
```bash
git checkout main
git merge upstream/main
```

### 3. Resolve Conflicts (if any)
```bash
# Edit conflicting files, then:
git add .
git commit -m "Merge upstream changes"
```

### 4. Push to Your Fork
```bash
git push origin main
```

## Keeping Updated with ClawRouter

### Option A: Regular Merge
```bash
git fetch upstream
git merge upstream/main
# Resolve conflicts if any
git push origin main
```

### Option B: Rebase (cleaner history)
```bash
git fetch upstream
git rebase upstream/main
# Resolve conflicts if any
git push origin main --force-with-lease
```

## Version Tracking

| ClawRouter Version | IgniteRouter Version |
|-------------------|---------------------|
| v0.12.137 | v0.12.137 (initial fork) |

## Differences from ClawRouter

This fork maintains its own identity while staying in sync with upstream. Custom modifications (if any) will be documented here.

---

**Upstream Repository:** https://github.com/BlockRunAI/ClawRouter