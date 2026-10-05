<script setup>
import { withBase } from 'vitepress';
import btwImage from '../../images/chat-btw.png';
import completionImage from '../../images/inline-completion.png';

const repository = 'https://github.com/fireman-droid/droid-for-vscode';
const docs = (page) => withBase(`/${page}.html`);
const release = `${repository}/releases/latest`;
</script>

<template>
  <div class="droid-home">
    <a class="home-skip" href="#main">跳到正文</a>
    <header class="home-header">
      <a class="home-brand" :href="withBase('/')" aria-label="Droid 项目首页">
        <img :src="withBase('/droid.svg')" width="28" height="28" alt="" />
        <span>DROID</span><span class="brand-edition">FOR YOUR EDITOR</span>
      </a>
      <nav class="home-nav" aria-label="主导航">
        <a href="#features">功能</a>
        <a href="#models">BYOK</a>
        <a :href="docs('GUIDE')">文档</a>
        <a :href="repository">GitHub <span aria-hidden="true">↗</span></a>
      </nav>
      <a class="home-button home-button-small" href="#install">开始使用 <span aria-hidden="true">↗</span></a>
    </header>

    <main id="main">
      <section class="home-hero" aria-labelledby="hero-title">
        <p class="home-eyebrow"><span class="home-status-dot" aria-hidden="true"></span> OPEN SOURCE · UNOFFICIAL · BUILT FOR DROID CLI</p>
        <h1 id="hero-title">让 Droid 的能力，<br />在编辑器里<span class="hero-emphasis">顺手起来。</span></h1>
        <p class="hero-description">更好读的对话，更清楚的改动。<br class="mobile-break" />把你的模型和日常工作，放回熟悉的编辑器。</p>
        <div class="home-actions">
          <a class="home-button" :href="release">下载 VSIX <span aria-hidden="true">↓</span></a>
          <a class="home-button home-button-outline" :href="docs('GETTING_STARTED')">安装指南 <span aria-hidden="true">↗</span></a>
        </div>
        <p class="hero-note">Factory Droid CLI 的非官方图形界面 · VS Code / Cursor</p>
      </section>

      <figure class="home-showcase home-width">
        <div class="showcase-heading"><span>DROID / IN YOUR WORKSPACE</span><span>CHAT + BY THE WAY</span></div>
        <a :href="btwImage" class="showcase-image" aria-label="查看聊天与 BTW 旁问的完整截图">
          <img :src="btwImage" width="955" height="1280" fetchpriority="high" alt="Droid 主对话中阅读 SQL 代码，右侧 BTW 面板保留独立的旁问对话" />
        </a>
        <figcaption><span>讨论继续，想到的另一件事也有地方放。</span><a :href="btwImage">查看完整截图 <span aria-hidden="true">↗</span></a></figcaption>
      </figure>

      <div class="home-facts home-width" aria-label="项目基本信息">
        <p><span>EDITOR</span>VS Code / Cursor</p>
        <p><span>MODELS</span>支持 BYOK</p>
        <p><span>SOURCE</span>MIT 开源</p>
        <p><span>MAINTAINED BY</span>社区独立维护</p>
      </div>

      <section id="features" class="home-section home-width" aria-labelledby="features-title">
        <div class="section-heading"><p class="home-eyebrow">01 / EVERYDAY WORK</p><h2 id="features-title">从看懂，到改好。<br /><span>在同一个工作空间。</span></h2></div>
        <div class="feature-columns">
          <article>
            <span class="feature-number">[ 01 ]</span>
            <h3>好好读一段对话</h3>
            <p>代码、表格、执行过程各有层次。工具细节按需展开，历史会话随时回来继续。</p>
            <a :href="docs('CHAT')">聊天与历史 <span aria-hidden="true">↗</span></a>
          </article>
          <article>
            <span class="feature-number">[ 02 ]</span>
            <h3>顺便问，不打断思路</h3>
            <p>选中上下文，打开 BTW 旁问。单独选择模型和推理强度，主对话留在原处。</p>
            <a :href="docs('CHAT') + '#打开-btw'">了解 BTW <span aria-hidden="true">↗</span></a>
          </article>
          <article>
            <span class="feature-number">[ 03 ]</span>
            <h3>看清每一次修改</h3>
            <p>从聊天直达 Review，聚焦真正变化的代码。统一或分栏比较，逐处检查，逐个标记。</p>
            <a :href="docs('REVIEW')">改动审阅 <span aria-hidden="true">↗</span></a>
          </article>
        </div>
      </section>

      <section id="models" class="home-model-section">
        <div class="home-width model-layout">
          <div>
            <p class="home-eyebrow">02 / YOUR MODELS</p>
            <h2>模型，<br />由你来选。</h2>
            <p class="section-description">沿用 Droid 的模型能力，也可以带上自己的 API Key。把服务渠道、模型和别名整理在一个界面里。</p>
            <a class="home-text-link" :href="docs('MODELS')">配置你的模型服务 <span aria-hidden="true">↗</span></a>
          </div>
          <div class="model-details">
            <div class="model-row"><span class="model-index">01</span><div><h3>官方 / BYOK / 混合</h3><p>按来源查看模型，保留自己的选择。</p></div></div>
            <div class="model-row"><span class="model-index">02</span><div><h3>多个渠道，独立配置</h3><p>同名模型也能分清接口与线路。</p></div></div>
            <div class="model-row"><span class="model-index">03</span><div><h3>禁用、恢复与别名</h3><p>调整常用模型，不必反复删除重建。</p></div></div>
            <p class="model-footnote">需要自行准备 Droid CLI 与可用的模型服务。扩展不附带订阅、API Key 或免费额度。</p>
          </div>
        </div>
      </section>

      <section class="home-section home-width completion-section" aria-labelledby="completion-title">
        <div class="completion-copy">
          <p class="home-eyebrow">03 / KEEP CODING</p>
          <h2 id="completion-title">想清楚了，<br />接着写。</h2>
          <p class="section-description">灰字补全跟上你的输入。Next Edit 提示下一处修改，先跳转，再接受。</p>
          <p class="completion-note">补全可独立启用，单独配置服务；无需先打开聊天。</p>
          <a class="home-text-link" :href="docs('AUTOCOMPLETE')">配置补全与 Next Edit <span aria-hidden="true">↗</span></a>
          <div class="keyboard-note"><kbd>Tab</kbd><span>接受补全</span><kbd>Esc</kbd><span>关闭建议</span></div>
        </div>
        <figure class="completion-figure">
          <a :href="completionImage" aria-label="查看编辑器灰字补全的完整截图"><img :src="completionImage" width="1257" height="1287" loading="lazy" alt="SQL 编辑器中显示 Droid 灰字代码补全及 Tab 接受提示" /></a>
          <figcaption>真实编辑器中的灰字补全。点击查看原图。</figcaption>
        </figure>
      </section>

      <section class="home-more home-width" aria-labelledby="more-title">
        <h2 id="more-title">还有这些，<br />需要时再展开。</h2>
        <div class="more-links">
          <a :href="docs('MISSIONS')"><div><h3>子代理与 Mission</h3><p>查看任务活动和进度，打开对应子会话。</p></div><span aria-hidden="true">↗</span></a>
          <a :href="docs('CAPABILITIES')"><div><h3>Skills、MCP 与插件</h3><p>在界面中查看和管理 Droid 的扩展能力。</p></div><span aria-hidden="true">↗</span></a>
          <a :href="docs('REVIEW') + '#选择比较范围'"><div><h3>一次编辑，或整个工作区</h3><p>按任务记录与 Git 范围，核对不同阶段的修改。</p></div><span aria-hidden="true">↗</span></a>
        </div>
      </section>

      <section id="install" class="home-section install-section home-width" aria-labelledby="install-title">
        <div class="section-heading"><p class="home-eyebrow">04 / GET STARTED</p><h2 id="install-title">打开编辑器。<br /><span>把 Droid 放进来。</span></h2></div>
        <ol class="install-steps">
          <li><span class="feature-number">[ 01 ]</span><h3>准备 Droid CLI</h3><p>先安装并认证 CLI，确认终端中的 Droid 和所选模型可用。</p><a href="https://docs.factory.ai/droid-cli/quickstart.md">Factory 官方指南 <span aria-hidden="true">↗</span></a></li>
          <li><span class="feature-number">[ 02 ]</span><h3>下载并安装 VSIX</h3><p>从 Releases 下载 <code>droid-版本号.vsix</code>，在扩展面板选择 Install from VSIX。</p><a :href="release">获取最新发布版 <span aria-hidden="true">↗</span></a></li>
          <li><span class="feature-number">[ 03 ]</span><h3>开始第一次对话</h3><p>执行 Reload Window，再运行 <code>Droid: Open Chat</code>，选择模型开始聊。</p><a :href="docs('GETTING_STARTED')">完整安装步骤 <span aria-hidden="true">↗</span></a></li>
        </ol>
        <p class="install-note">需要兼容 VS Code API 1.108.0+ 的编辑器。当前主要在 Windows 上开发与验证，其他平台与远程环境尚未完成同等验收。GitHub 下载版需手动更新。</p>
      </section>

      <section class="home-contribute home-width" aria-labelledby="contribute-title">
        <div><p class="home-eyebrow">OPEN SOURCE / BUILT IN THE OPEN</p><h2 id="contribute-title">用得顺手，一起打磨。</h2><p>一个从日常使用出发的社区项目。欢迎提出问题，也欢迎带着你的改进来。</p></div>
        <div class="home-actions"><a class="home-button" :href="repository">查看源码 <span aria-hidden="true">↗</span></a><a class="home-button home-button-outline" :href="`${repository}/issues`">反馈问题 <span aria-hidden="true">↗</span></a></div>
      </section>
    </main>

    <footer class="home-footer home-width">
      <div class="footer-top"><a class="home-brand" :href="withBase('/')"><img :src="withBase('/droid.svg')" width="24" height="24" alt="" /><span>DROID</span></a><nav aria-label="页脚导航"><a :href="docs('GUIDE')">文档</a><a :href="release">Releases</a><a :href="`${repository}/blob/main/LICENSE`">MIT 许可</a><a href="https://linux.do/">LINUX DO</a></nav></div>
      <p>Factory Droid CLI 的非官方 VS Code / Cursor 扩展，由社区独立维护。本站及项目不由 Factory 官方发布、维护或背书。Factory 名称与风车标识归各自权利人所有。</p>
      <p class="footer-meta">聊天与补全分别使用配置的模型服务，服务费用由对应提供方收取。<a :href="docs('TROUBLESHOOTING')">数据与诊断说明 <span aria-hidden="true">↗</span></a></p>
    </footer>
  </div>
</template>
