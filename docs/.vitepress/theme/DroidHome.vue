<script setup>
import { ref } from 'vue';
import { withBase } from 'vitepress';
import HomeMotionText from './HomeMotionText.vue';
import { useHomeMotion } from './homeMotion';
import btwImage from '../../images/chat-btw.png';
import completionImage from '../../images/inline-completion.png';
import taskImage from '../../images/chat-task.png';
import historyImage from '../../images/chat-history.png';

const root = ref();
const paused = ref(false);
const repository = 'https://github.com/fireman-droid/droid-for-vscode';
const docs = (page) => withBase(`/${page}.html`);
const release = `${repository}/releases/latest`;
const modelRows = [
  ['Claude', 'Gemini', 'DeepSeek', 'Kimi', 'GPT', 'GLM'],
  ['官方模型', 'BYOK', '独立渠道', '模型别名', '推理强度'],
];
const features = [
  {
    name: '把过程展开，把噪声收起。',
    label: 'CHAT / READ & THINK',
    image: taskImage,
    alt: '聊天中的任务清单、工具调用和折叠的执行过程',
    text: '代码、表格和执行过程各有层次。需要细节时再展开，长对话也能沿着思路读下去。',
    page: 'CHAT',
  },
  {
    name: '顺便问一句，主线继续。',
    label: 'BY THE WAY / STAY FOCUSED',
    image: btwImage,
    alt: '主对话右侧打开独立的 BTW 旁问',
    text: '从选中的上下文打开旁问，单独选择模型和推理强度，不必离开正在进行的对话。',
    page: 'CHAT',
    anchor: '#打开-btw',
  },
  {
    name: '输入之后，还有下一步。',
    label: 'AUTOCOMPLETE / KEEP CODING',
    image: completionImage,
    alt: 'SQL 编辑器中的灰字代码补全和 Tab 接受提示',
    text: '灰字补全跟上你的输入，Next Edit 提示下一处修改。补全服务独立配置，无需先打开聊天。',
    page: 'AUTOCOMPLETE',
  },
  {
    name: '回到之前聊到的地方。',
    label: 'HISTORY / PICK UP THE THREAD',
    image: historyImage,
    alt: '按时间分组的会话历史与搜索入口',
    text: '搜索历史会话，恢复上下文，接着上一次的思路工作。',
    page: 'CHAT',
  },
];
useHomeMotion(root);
</script>

<template>
  <div ref="root" class="droid-home">
    <a class="home-skip" href="#main">跳到正文</a>
    <header class="home-header">
      <a class="home-brand" :href="withBase('/')" aria-label="Droid 项目首页"
        ><img
          :src="withBase('/droid.svg')"
          width="25"
          height="25"
          alt=""
        /><span>DROID</span><span class="brand-edition">FOR VS CODE</span></a
      >
      <nav class="home-nav" aria-label="主导航">
        <a href="#features">功能</a><a href="#models">模型</a
        ><a :href="docs('GUIDE')">文档</a><a :href="repository">GitHub ↗</a>
      </nav>
      <a class="home-button home-button-small" href="#install"
        >开始使用 <span aria-hidden="true">↗</span></a
      >
    </header>
    <main id="main">
      <section class="home-hero" aria-labelledby="hero-title">
        <div class="hero-mark">
          <img
            data-hero-mark
            :src="withBase('/droid.svg')"
            width="76"
            height="76"
            alt=""
          />
        </div>
        <h1 id="hero-title">
          <HomeMotionText
            text="让 DROID 的能力，"
            mode="scramble"
            :delay="180"
          /><HomeMotionText
            text="在编辑器里顺手起来。"
            mode="scramble"
            :delay="340"
          />
        </h1>
        <p class="hero-description">
          更好读的对话，更清楚的改动。<br
            class="mobile-break"
          />你的模型，你熟悉的工作空间。
        </p>
        <div class="hero-access">
          <div class="home-actions">
            <a class="home-button" :href="release"
              >下载 VSIX <span aria-hidden="true">↓</span></a
            ><a
              class="home-button home-button-outline"
              :href="docs('GETTING_STARTED')"
              >安装指南 <span aria-hidden="true">→</span></a
            >
          </div>
          <p class="hero-note">
            <span class="status-dot"></span> MIT 开源 <span>/</span> Factory
            Droid CLI 的非官方 GUI
          </p>
        </div>
      </section>
      <figure class="home-showcase home-width">
        <div class="showcase-bar">
          <span><i></i><i></i><i></i></span><span>DROID / YOUR WORKSPACE</span
          ><span>CHAT + BTW</span>
        </div>
        <div class="showcase-stage">
          <div class="showcase-grid" aria-hidden="true"></div>
          <a
            :href="btwImage"
            class="showcase-image"
            aria-label="查看聊天与 BTW 旁问的完整截图"
            ><img
              :src="btwImage"
              width="955"
              height="1280"
              fetchpriority="high"
              alt="Droid 中阅读 SQL 代码，右侧 BTW 面板保留独立的旁问对话" /></a
          ><span class="stage-caption" aria-hidden="true"
            >ONE WORKSPACE.<br />MORE ROOM TO THINK.</span
          >
        </div>
        <figcaption>
          <span>主线继续，想到的另一件事也有地方放。</span
          ><a :href="btwImage">查看原图 ↗</a>
        </figcaption>
      </figure>
      <div class="home-facts home-width" aria-label="项目基本信息">
        <p><span>WORKSPACE</span>VS Code / Cursor</p>
        <p><span>MODELS</span>官方模型 + BYOK</p>
        <p><span>LICENSE</span>MIT 开源</p>
        <p><span>BUILT BY</span>社区独立维护</p>
      </div>
      <section
        id="features"
        class="home-section home-width"
        aria-labelledby="features-title"
      >
        <div class="section-heading">
          <p class="home-eyebrow" data-reveal>01 / FROM CLI TO YOUR EDITOR</p>
          <h2 id="features-title">
            <HomeMotionText text="把注意力，留给正在做的事。" />
          </h2>
          <p data-reveal>从阅读对话到检查修改，少一些来回切换。</p>
        </div>
        <div class="feature-pillars">
          <article data-reveal>
            <span class="feature-number">01</span>
            <h3>读得舒服</h3>
            <p>有层次的对话与执行过程</p>
            <p class="muted">
              Markdown、代码块、表格和工具输出。在 GUI 里整理 CLI 的信息密度。
            </p>
            <a :href="docs('CHAT')">认识聊天界面 ↗</a>
          </article>
          <article data-reveal :data-delay="150">
            <span class="feature-number">02</span>
            <h3>选得自由</h3>
            <p>沿用 Droid，也带上自己的模型</p>
            <p class="muted">
              官方、BYOK 与混合列表，独立的渠道配置，让常用模型有序可选。
            </p>
            <a :href="docs('MODELS')">配置模型服务 ↗</a>
          </article>
          <article data-reveal :data-delay="300">
            <span class="feature-number">03</span>
            <h3>改得清楚</h3>
            <p>从聊天里的改动直达 Review</p>
            <p class="muted">
              聚焦变化行，按任务或 Git 范围比较。统一、分栏、已查看，逐处核对。
            </p>
            <a :href="docs('REVIEW')">了解改动审阅 ↗</a>
          </article>
        </div>
      </section>
      <section
        id="models"
        class="home-model-section home-width"
        aria-labelledby="models-title"
      >
        <div class="model-copy" data-reveal>
          <p class="home-eyebrow">02 / YOUR MODELS. YOUR CHOICE.</p>
          <h2 id="models-title">模型不必将就，<br />用你习惯的那一个。</h2>
          <p>
            带上自己的 API Key，管理不同渠道与模型别名。聊天、BTW
            和补全，各自选择合适的配置。
          </p>
          <a class="home-text-link" :href="docs('MODELS')"
            >配置 BYOK <span aria-hidden="true">→</span></a
          >
        </div>
        <div class="model-streams" :class="{ 'is-paused': paused }">
          <div
            v-for="(models, row) in modelRows"
            :key="row"
            class="model-stream"
            :class="{ reverse: row === 1 }"
          >
            <div class="model-track">
              <div
                v-for="copy in 2"
                :key="copy"
                class="model-group"
                :aria-hidden="copy === 2 ? 'true' : undefined"
              >
                <span
                  v-for="(model, index) in models"
                  :key="model"
                  class="model-chip"
                  ><span class="model-glyph" aria-hidden="true">{{
                    row === 0 ? ['✳', '✦', '≈', 'K', '◎', '◇'][index] : '+'
                  }}</span
                  >{{ model }}</span
                >
              </div>
            </div>
          </div>
          <div class="model-stream-footer">
            <p>模型可用性取决于你的服务与配置。</p>
            <button
              type="button"
              :aria-pressed="paused"
              @click="paused = !paused"
            >
              {{ paused ? '播放动画' : '暂停动画' }}
            </button>
          </div>
        </div>
      </section>
      <section class="home-section home-width" aria-labelledby="workflow-title">
        <div class="section-heading section-heading-left">
          <p class="home-eyebrow" data-reveal>03 / MADE FOR EVERYDAY WORK</p>
          <h2 id="workflow-title">
            <HomeMotionText text="一个窗口，装下日常工作。" />
          </h2>
          <p data-reveal>看看 Droid 在真实编辑器里的样子。</p>
        </div>
        <div class="workflow-grid">
          <article
            v-for="feature in features"
            :key="feature.page + feature.label"
            class="workflow-item"
            data-reveal
          >
            <a
              :href="feature.image"
              class="workflow-image"
              :class="{ 'completion-image': feature.page === 'AUTOCOMPLETE' }"
              :aria-label="`查看${feature.name}的完整截图`"
              ><img
                :src="feature.image"
                loading="lazy"
                :alt="feature.alt"
                width="955"
                height="1280"
              /><span>查看原图 ↗</span></a
            >
            <p class="home-eyebrow">{{ feature.label }}</p>
            <h3>{{ feature.name }}</h3>
            <p class="workflow-description">{{ feature.text }}</p>
            <a
              class="home-text-link"
              :href="docs(feature.page) + (feature.anchor || '')"
              >了解功能 <span aria-hidden="true">→</span></a
            >
          </article>
        </div>
      </section>
      <section class="home-details home-width" aria-labelledby="details-title">
        <div class="details-heading">
          <p class="home-eyebrow" data-reveal>ROOM FOR MORE</p>
          <h2 id="details-title">
            <HomeMotionText text="需要时，再多走一步。" />
          </h2>
        </div>
        <div class="details-grid">
          <a :href="docs('MISSIONS')" data-reveal
            ><span class="detail-index">01 / AGENTS</span>
            <h3>子代理与 Mission <span>↗</span></h3>
            <p>跟踪任务活动，打开子会话。Mission 仍在持续完善，欢迎反馈。</p></a
          ><a :href="docs('CAPABILITIES')" data-reveal
            ><span class="detail-index">02 / EXTENSIONS</span>
            <h3>Skills、MCP 与插件 <span>↗</span></h3>
            <p>查看和管理 Droid 的扩展能力，把常用工具接进工作流。</p></a
          ><a :href="docs('REVIEW')" data-reveal
            ><span class="detail-index">03 / REVIEW</span>
            <h3>从一次编辑到工作区 <span>↗</span></h3>
            <p>任务记录、分支和暂存区，各自选择比较范围。</p></a
          >
        </div>
      </section>
      <section
        id="install"
        class="home-section home-width"
        aria-labelledby="install-title"
      >
        <div class="section-heading">
          <p class="home-eyebrow" data-reveal>04 / GET STARTED</p>
          <h2 id="install-title">
            <HomeMotionText text="打开编辑器，把 Droid 放进来。" />
          </h2>
          <p data-reveal>一个 VSIX。保留你自己的 CLI、模型和工作目录。</p>
        </div>
        <ol class="install-steps">
          <li data-reveal>
            <span class="feature-number">01</span>
            <h3>准备 Droid CLI</h3>
            <p>先安装并认证 CLI，确认终端中的 Droid 与所选模型可用。</p>
            <a href="https://docs.factory.ai/droid-cli/quickstart.md"
              >Factory 官方指南 ↗</a
            >
          </li>
          <li data-reveal :data-delay="150">
            <span class="feature-number">02</span>
            <h3>安装 VSIX</h3>
            <p>
              下载 <code>droid-版本号.vsix</code>，在扩展面板选择 Install from
              VSIX。
            </p>
            <a :href="release">下载最新发布版 ↗</a>
          </li>
          <li data-reveal :data-delay="300">
            <span class="feature-number">03</span>
            <h3>开始对话</h3>
            <p>执行 Reload Window，然后运行 <code>Droid: Open Chat</code>。</p>
            <a :href="docs('GETTING_STARTED')">完整安装步骤 ↗</a>
          </li>
        </ol>
        <p class="install-note">
          需要兼容 VS Code API 1.108.0+ 的编辑器。当前主要在 Windows
          上开发与验证，其他平台与远程环境尚未完成同等验收。GitHub
          下载版需手动更新；扩展不附带订阅、API Key 或免费额度。
        </p>
      </section>
      <section class="home-contribute">
        <div class="home-width">
          <p class="home-eyebrow">OPEN SOURCE. OPEN TO YOUR IDEAS.</p>
          <h2>用得顺手，<br />一起打磨。</h2>
          <p>从自己的日常需要出发，也期待成为你的趁手工具。</p>
          <div class="home-actions">
            <a class="home-button" :href="repository"
              >查看源码 <span aria-hidden="true">↗</span></a
            ><a
              class="home-button home-button-outline"
              :href="`${repository}/issues`"
              >反馈问题 <span aria-hidden="true">↗</span></a
            >
          </div>
          <span class="footer-wordmark" aria-hidden="true">DROID</span>
        </div>
      </section>
    </main>
    <footer class="home-footer home-width">
      <div class="footer-top">
        <a class="home-brand" :href="withBase('/')"
          ><img
            :src="withBase('/droid.svg')"
            width="24"
            height="24"
            alt=""
          /><span>DROID</span></a
        >
        <nav aria-label="页脚导航">
          <a :href="docs('GUIDE')">文档</a><a :href="release">Releases</a
          ><a :href="`${repository}/blob/main/LICENSE`">MIT 许可</a
          ><a href="https://linux.do/">LINUX DO</a>
        </nav>
      </div>
      <p>
        Factory Droid CLI 的非官方 VS Code / Cursor
        扩展，由社区独立维护。本站及项目不由 Factory
        官方发布、维护或背书。Factory 名称与风车标识归各自权利人所有。
      </p>
      <p>
        聊天与补全分别使用配置的模型服务，费用由对应提供方收取。<a
          :href="docs('TROUBLESHOOTING')"
          >数据与诊断说明 ↗</a
        >
      </p>
    </footer>
  </div>
</template>
