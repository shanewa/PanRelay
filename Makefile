# 度盘接力存 — 扩展商店打包（zip 根目录即为 manifest.json）
# Windows 无 make 时：node scripts/pack-extension.mjs

.PHONY: help pack check clean list unlock-code

EXTENSION := extension
DIST := dist
VERSION := $(shell node -p "JSON.parse(require('fs').readFileSync('$(EXTENSION)/manifest.json','utf8')).version")

help:
	@echo "度盘接力存 · 打包"
	@echo ""
	@echo "  make pack   - 生成 dist/PanRelay-$(VERSION).zip（仅 extension/ 白名单文件）"
	@echo "  make check  - 检查文件齐全、无远程 JS，不生成 zip"
	@echo "  make list   - 打印将打入 zip 的文件列表"
	@echo "  make clean  - 删除 dist/*.zip"
	@echo "  make unlock-code - 生成当月公众号解锁码（填到自动回复）"
	@echo ""
	@echo "提交前：zip 根目录直接看到 manifest.json，不要 插件名/extension/manifest.json"
	@echo "本地测：edge://extensions 加载已解压的 $(EXTENSION)/ 目录"

pack:
	node scripts/pack-extension.mjs

check:
	node scripts/pack-extension.mjs --check-only

list:
	node scripts/pack-extension.mjs --list-only

clean:
	@if [ -d "$(DIST)" ]; then rm -f "$(DIST)"/*.zip; echo "已清理 $(DIST)/*.zip"; fi

unlock-code:
	node scripts/gen-unlock-code.mjs
