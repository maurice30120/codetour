#!/bin/bash
# verify-fixture.sh - Script to verify G3 fixture validation
# Part of T04 - PostgreSQL fixture and sealed question set

set -e

echo "=========================================="
echo "G3 Fixture Validation Script"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0

# Function to check and report
check() {
    local description="$1"
    local command="$2"
    
    echo -n "Checking: $description... "
    
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL${NC}"
        ((FAIL++))
        return 1
    fi
}

# Function to check and report with value
check_value() {
    local description="$1"
    local command="$2"
    local expected="$3"
    
    echo -n "Checking: $description... "
    
    local actual=$(eval "$command" 2>/dev/null)
    if [ "$actual" = "$expected" ]; then
        echo -e "${GREEN}PASS${NC} (value: $actual)"
        ((PASS++))
    else
        echo -e "${RED}FAIL${NC} (expected: $expected, got: $actual)"
        ((FAIL++))
        return 1
    fi
}

echo "1. PostgreSQL Fixture Checks"
echo "----------------------------"

# Check PostgreSQL directory exists
check "PostgreSQL directory exists" "test -d poc/benchmark/postgres"

# Check SHA
cd poc/benchmark/postgres
check_value "SHA matches 70c4a57b64d39c526eb4c44a925eb92a6e56f3c5" "git rev-parse HEAD" "70c4a57b64d39c526eb4c44a925eb92a6e56f3c5"

# Check clean tree
check "Working tree is clean" "git status --porcelain | grep -v '^??' | test -z"

# Check read-only
check "Files are read-only" "find . -type f -perm -u+w | test -z"

# Check .git directory exists (it's a clone)
check ".git directory exists (it's a git repo)" "test -d .git"

cd ../..

echo ""
echo "2. Question Files Checks"
echo "--------------------------"

# Check questions file exists
check "postgres-questions.json exists" "test -f poc/benchmark/postgres-questions.json"

# Check expected answers file exists
check "postgres-expected-answers.json exists" "test -f poc/benchmark/postgres-expected-answers.json"

# Check manifest exists
check "manifest.json exists" "test -f poc/benchmark/manifest.json"

# Validate JSON files
check "postgres-questions.json is valid JSON" "jq empty poc/benchmark/postgres-questions.json"
check "postgres-expected-answers.json is valid JSON" "jq empty poc/benchmark/postgres-expected-answers.json"
check "manifest.json is valid JSON" "jq empty poc/benchmark/manifest.json"

# Check question count
echo -n "Checking: Question count is 40... "
count=$(jq '.series_R | length + .series_T | length' poc/benchmark/postgres-questions.json)
if [ "$count" = "40" ]; then
    echo -e "${GREEN}PASS${NC} (count: $count)"
    ((PASS++))
else
    echo -e "${RED}FAIL${NC} (expected: 40, got: $count)"
    ((FAIL++))
fi

# Check SHA in questions
check_value "Questions have correct postgres_sha" "jq -r '.series_R[0].postgres_sha' poc/benchmark/postgres-questions.json" "70c4a57b64d39c526eb4c44a925eb92a6e56f3c5"

echo ""
echo "3. Hash Validation"
echo "-------------------"

# Calculate current fixture hash
cd poc/benchmark/postgres
CURRENT_FIXTURE_HASH=$(find . -type f -exec sha256sum {} \; 2>/dev/null | sort | sha256sum | awk '{print $1}')
cd ../..

# Get expected hash from manifest
EXPECTED_FIXTURE_HASH=$(jq -r '.fixture_hash | split(":")[1]' poc/benchmark/manifest.json)

if [ "$CURRENT_FIXTURE_HASH" = "$EXPECTED_FIXTURE_HASH" ]; then
    echo -e "Fixture hash: ${GREEN}PASS${NC} (matches: $CURRENT_FIXTURE_HASH)"
    ((PASS++))
else
    echo -e "Fixture hash: ${RED}FAIL${NC} (expected: $EXPECTED_FIXTURE_HASH, got: $CURRENT_FIXTURE_HASH)"
    ((FAIL++))
fi

echo ""
echo "=========================================="
echo "G3 Validation Summary"
echo "=========================================="
echo -e "${GREEN}PASS: $PASS${NC}"
echo -e "${RED}FAIL: $FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}G3 VALIDATION: PASSED${NC}"
    echo ""
    echo "All checks passed. The fixture is valid."
    exit 0
else
    echo -e "${RED}G3 VALIDATION: FAILED${NC}"
    echo ""
    echo "Some checks failed. Please review the errors above."
    exit 1
fi
