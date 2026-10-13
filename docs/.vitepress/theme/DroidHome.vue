<script setup>
// Factory homepage: 50634-9bf7675347044e4c, pretty L182–399 / L1067–1348.
// Product content and Vue adaptations are documented in docs/DESIGN.md.
import { onMounted, onUnmounted, ref } from 'vue';
import { withBase } from 'vitepress';
import { version } from '../../../package.json';
import HomeMotionText from './HomeMotionText.vue';
import { useHomeMotion } from './homeMotion';
import chatImage from '../../images/v0.8.10/raw/02-chat-plan.png';
import reviewImage from '../../images/v0.8.10/raw/04-review-split.png';
import btwImage from '../../images/v0.8.10/raw/17-btw.png';
import modelImage from '../../images/v0.8.10/raw/12-byok-models.png';
import missionImage from '../../images/v0.8.10/raw/20-mission-progress.png';
import completionImage from '../../images/v0.8.10/raw/22-inline-completion.png';
import contextImage from '../../images/v0.8.10/raw/32-attachment-context.png';
import historyImage from '../../images/v0.8.10/raw/35-session-switcher.png';
import settingsImage from '../../images/v0.8.10/raw/24-general-settings.png';

const root = ref();
const mobileOpen = ref(false);
const mobileTrigger = ref();
const paused = ref(false);
const copied = ref(false);
const copyError = ref(false);
const activeStep = ref(0);
const repository = 'https://github.com/fireman-droid/droid-for-vscode';
const release = `${repository}/releases/latest`;
const marketplace = 'https://open-vsx.org/extension/droidvisx/droidvisx';
const docs = (page) => withBase(`/${page}.html`);
const installCommand = `code --install-extension droid-${version}.vsix`;
const modelRows = [
  ['Claude', 'GPT', 'Gemini', 'DeepSeek', 'Kimi', 'GLM'],
  ['官方模型', 'BYOK', '自定义渠道', '模型别名', '推理强度'],
];
const pillars = [
  [
    'CONTEXT',
    '带着上下文开始',
    '把文件、选区和诊断交给 Droid，在当前项目里理解问题、讨论方案。',
  ],
  [
    'CONTROL',
    '按自己的方式推进',
    '选择模型与推理强度，在自动、计划与任务模式之间掌握执行节奏。',
  ],
  [
    'CLARITY',
    '看清每一处改动',
    '从工具记录到文件 Diff，随时检查过程，逐项审阅结果。',
  ],
];
const features = [
  {
    name: '对话与计划',
    image: chatImage,
    page: 'CHAT',
    text: '讨论实现方案，追踪任务步骤，按需展开工具执行记录。',
    position: 'top left',
  },
  {
    name: '代码审阅',
    image: reviewImage,
    page: 'REVIEW',
    text: '分栏或合并查看 Diff，选择代码直接提问，逐项确认修改。',
    position: 'top left',
  },
  {
    name: 'BTW 旁问',
    image: btwImage,
    page: 'CHAT',
    text: '在主对话旁单独提问，让临时问题有自己的上下文。',
    position: 'top right',
  },
  {
    name: 'Mission',
    image: missionImage,
    page: 'MISSIONS',
    text: '设定交付目标，查看 Worker 进度与 Validator 检查结果。',
    position: 'top left',
  },
  {
    name: 'BYOK 模型',
    image: modelImage,
    page: 'MODELS',
    text: '接入自己的服务渠道，管理模型、别名和推理强度。',
    position: 'top left',
  },
  {
    name: '代码补全',
    image: completionImage,
    page: 'AUTOCOMPLETE',
    text: '在原生编辑器中获得灰字补全与 Next Edit 修改提示。',
    position: 'top right',
  },
  {
    name: '文件与选区',
    image: contextImage,
    page: 'CHAT',
    text: '用紧凑的行内引用携带代码，点击即可回到对应位置。',
    position: 'bottom left',
  },
  {
    name: '会话历史',
    image: historyImage,
    page: 'CHAT',
    text: '搜索、收藏和切换会话，继续之前的讨论与任务。',
    position: 'top left',
  },
];
const workflows = [
  [
    '01',
    '理解陌生代码',
    '引用一段实现，追问它的依赖、边界和调用路径。',
    'CHAT',
  ],
  [
    '02',
    '实现一个功能',
    '先讨论计划，再跟踪执行，最后打开 Diff 检查修改。',
    'REVIEW',
  ],
  [
    '03',
    '推进一项任务',
    '明确 Mission 的目标，按功能查看执行与验证进度。',
    'MISSIONS',
  ],
];
const steps = [
  {
    title: '安装编辑器扩展',
    text: `从 Open VSX 安装，或下载 Release 中的 droid-${version}.vsix，在编辑器里选择“从 VSIX 安装”。`,
    image: completionImage,
    page: 'GETTING_STARTED',
    link: '查看安装指南',
  },
  {
    title: '连接 CLI 与模型',
    text: '按指南准备 Factory Droid CLI，完成登录。需要自定义服务时，在模型管理中添加 BYOK 渠道。',
    image: modelImage,
    page: 'MODELS',
    link: '配置模型与渠道',
  },
  {
    title: '从当前代码开始',
    text: '打开项目，添加文件或选中的代码，发送第一个问题。需要先讨论方案时，切换到计划模式。',
    image: chatImage,
    page: 'CHAT',
    link: '了解聊天与计划',
  },
];
const guides = [
  {
    label: 'GET STARTED',
    title: '安装与第一次对话',
    text: '从下载扩展到连接模型。',
    page: 'GETTING_STARTED',
    image: settingsImage,
  },
  {
    label: 'WORKFLOW',
    title: '审阅文件改动',
    text: '理解 Diff、代码问答与改动范围。',
    page: 'REVIEW',
    image: reviewImage,
  },
  {
    label: 'DEVELOPMENT',
    title: '参与项目开发',
    text: '配置环境，定位代码，提交第一个修改。',
    page: 'DEVELOPMENT',
    image: completionImage,
  },
];
let copyTimer;
async function copyInstallCommand() {
  copyError.value = false;
  try {
    await navigator.clipboard.writeText(installCommand);
    copied.value = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    copyError.value = true;
  }
}
function closeMenus(event) {
  if (event.type === 'keydown' && event.key !== 'Escape') return;
  root.value
    ?.querySelectorAll('details[data-home-menu][open]')
    .forEach((menu) => {
      if (event.type === 'keydown' || !menu.contains(event.target)) {
        menu.open = false;
        if (event.type === 'keydown') menu.querySelector('summary')?.focus();
      }
    });
  if (event.type === 'keydown' && mobileOpen.value) {
    mobileOpen.value = false;
    mobileTrigger.value?.focus();
  }
}
function followLink(event) {
  if (!event.target.closest('a')) return;
  mobileOpen.value = false;
  root.value
    ?.querySelectorAll('details[data-home-menu][open]')
    .forEach((menu) => {
      menu.open = false;
    });
}
onMounted(() => {
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', closeMenus);
});
onUnmounted(() => {
  document.removeEventListener('click', closeMenus);
  document.removeEventListener('keydown', closeMenus);
  clearTimeout(copyTimer);
});
useHomeMotion(root);
</script>

<template>
  <div ref="root" class="droid-home" @click="followLink">
    <a class="home-skip" href="#main">跳到正文</a>
    <header class="home-header">
      <a class="home-brand" :href="withBase('/')" aria-label="Droid 首页">
        <img :src="withBase('/droid.svg')" width="26" height="26" alt="" /><span
          >DROID</span
        >
      </a>
      <nav class="home-nav" aria-label="主导航">
        <details class="home-menu" data-home-menu>
          <summary>
            产品 <span class="home-chevron" aria-hidden="true"></span>
          </summary>
          <div class="home-menu-panel">
            <a href="#features">全部功能 <span>↗</span></a>
            <a :href="docs('CHAT')">聊天与计划</a>
            <a :href="docs('REVIEW')">代码审阅</a>
            <a :href="docs('MISSIONS')">Mission 与子代理</a>
            <a :href="docs('AUTOCOMPLETE')">代码补全</a>
          </div>
        </details>
        <a href="#models">模型</a>
        <a :href="docs('GUIDE')">文档</a>
        <a :href="`${repository}/releases`">更新日志</a>
        <a :href="repository">GitHub ↗</a>
      </nav>
      <div class="header-actions">
        <a class="home-button" :href="marketplace"
          >安装扩展 <span aria-hidden="true">↗</span></a
        >
        <a
          class="home-button home-button-outline"
          :href="docs('GETTING_STARTED')"
          >开始使用</a
        >
      </div>
      <button
        ref="mobileTrigger"
        class="mobile-menu-trigger"
        :aria-expanded="mobileOpen"
        aria-controls="home-mobile-nav"
        :aria-label="mobileOpen ? '关闭导航' : '打开导航'"
        @click="mobileOpen = !mobileOpen"
      >
        <span :class="{ 'is-open': mobileOpen }" aria-hidden="true"></span>
      </button>
      <nav
        v-if="mobileOpen"
        id="home-mobile-nav"
        class="home-mobile-nav"
        aria-label="移动端导航"
      >
        <a href="#features">产品功能 <span>↗</span></a
        ><a href="#models">模型</a> <a :href="docs('GUIDE')">文档</a
        ><a :href="`${repository}/releases`">更新日志</a>
        <a :href="repository">GitHub ↗</a><a :href="release">下载 VSIX ↓</a>
      </nav>
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
            text="BUILD WITH DROID."
            mode="scramble"
            :delay="180"
          />
          <HomeMotionText
            text="RIGHT IN YOUR EDITOR."
            mode="scramble"
            :delay="340"
          />
        </h1>
        <p class="hero-description">
          从想法到代码，在 VS Code 与 Cursor 中完成。
        </p>
        <div class="hero-access">
          <div class="home-actions">
            <details class="home-menu download-menu" data-home-menu>
              <summary class="home-button">
                下载 Droid <span class="home-chevron" aria-hidden="true"></span>
              </summary>
              <div class="home-menu-panel">
                <a :href="marketplace">Open VSX <span>↗</span></a>
                <a :href="release">下载 VSIX <span>↓</span></a>
                <a :href="docs('GETTING_STARTED')">安装指南 <span>→</span></a>
              </div>
            </details>
            <a class="home-button home-button-outline" :href="docs('GUIDE')"
              >阅读文档 <span aria-hidden="true">→</span></a
            >
          </div>
          <a class="hero-release" :href="release"
            ><span class="release-dot" aria-hidden="true"></span>v{{ version }}
            <span class="release-divider">/</span> 查看最新版本
            <span aria-hidden="true">↗</span></a
          >
        </div>
      </section>

      <figure class="hero-product home-wide">
        <div class="product-pair">
          <img
            :src="chatImage"
            width="1360"
            height="1480"
            alt="Droid 聊天中的任务计划与文件改动"
            fetchpriority="high"
          />
          <img
            :src="reviewImage"
            width="2400"
            height="1520"
            alt="Droid 分栏 Diff 与文件导航"
            fetchpriority="high"
          />
        </div>
        <figcaption>
          v0.8.10 生产组件 · 演示数据 · 聊天与审阅两个场景
        </figcaption>
      </figure>

      <section
        class="home-environments home-container"
        aria-label="支持的开发环境与扩展方式"
      >
        <p class="home-eyebrow">融入现有的开发方式</p>
        <div class="environment-grid">
          <span>Visual Studio Code</span><span>Cursor</span
          ><span>Factory CLI</span><span>Open VSX</span><span>BYOK</span
          ><span>Skills</span><span>MCP</span><span>Git</span>
        </div>
      </section>

      <section
        class="home-foundation home-container"
        aria-labelledby="foundation-title"
      >
        <div class="section-heading centered">
          <h2 id="foundation-title">
            <HomeMotionText text="你的编辑器，也是 AI 工作台。" />
          </h2>
          <p data-reveal>在熟悉的项目与代码之间，完成讨论、执行和审阅。</p>
        </div>
        <ol class="pillar-grid">
          <li
            v-for="(pillar, index) in pillars"
            :key="pillar[0]"
            data-reveal
            :data-delay="index * 100"
          >
            <p class="home-eyebrow">
              <span>0{{ index + 1 }}</span> {{ pillar[0] }}
            </p>
            <h3>{{ pillar[1] }}</h3>
            <p>{{ pillar[2] }}</p>
          </li>
        </ol>
      </section>

      <section
        id="models"
        class="home-models home-wide"
        aria-labelledby="models-title"
      >
        <p class="home-eyebrow">MODELS / 模型与渠道</p>
        <div class="models-layout">
          <div class="section-heading">
            <h2 id="models-title">模型，<br />由你来选择。</h2>
            <p>
              使用官方模型，或接入自己的服务渠道。按任务选择模型与推理强度，在同一个界面里管理。
            </p>
            <a class="home-text-link" :href="docs('MODELS')"
              >了解模型配置 <span aria-hidden="true">→</span></a
            >
          </div>
          <div class="models-display">
            <div
              class="model-streams"
              :class="{ 'is-paused': paused }"
              aria-label="模型与配置能力"
            >
              <div
                v-for="(row, index) in modelRows"
                :key="index"
                class="model-stream"
                :class="{ reverse: index === 1 }"
              >
                <div
                  v-for="copy in 2"
                  :key="copy"
                  class="model-stream-group"
                  :aria-hidden="copy === 2 ? 'true' : undefined"
                >
                  <span v-for="model in row" :key="model">{{ model }}</span>
                </div>
              </div>
            </div>
            <div class="model-note">
              <span>可用模型以连接的服务和账户为准</span
              ><button
                :aria-pressed="paused"
                :aria-label="paused ? '播放模型展示' : '暂停模型展示'"
                @click="paused = !paused"
              >
                {{ paused ? '播放' : '暂停' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section
        id="features"
        class="home-features home-container"
        aria-labelledby="features-title"
      >
        <div class="section-heading">
          <h2 id="features-title">
            <HomeMotionText text="让每一步开发衔接起来。" />
          </h2>
          <p>从正在讨论的问题，到即将提交的代码。需要的工具，都在工作流里。</p>
        </div>
        <ul class="feature-grid">
          <li
            v-for="(feature, index) in features"
            :key="feature.name"
            data-reveal
            :data-delay="(index % 4) * 70"
          >
            <a :href="docs(feature.page)"
              ><div class="feature-image">
                <img
                  :src="feature.image"
                  :alt="`${feature.name}界面`"
                  :style="{ objectPosition: feature.position }"
                  loading="lazy"
                  width="600"
                  height="600"
                />
              </div>
              <h3>{{ feature.name }} <span aria-hidden="true">↗</span></h3>
              <p>{{ feature.text }}</p></a
            >
          </li>
        </ul>
      </section>

      <section
        class="home-integrations home-container"
        aria-labelledby="integrations-title"
      >
        <p class="home-eyebrow">EXTENSIBLE BY DESIGN</p>
        <div class="integration-layout">
          <div class="section-heading">
            <h2 id="integrations-title">连接你已有的工具。</h2>
            <p>
              用 Skills 组织可复用的方法，通过 MCP
              扩展工具能力，在统一入口管理插件。
            </p>
            <a class="home-text-link" :href="docs('CAPABILITIES')"
              >查看支持范围 <span aria-hidden="true">→</span></a
            >
          </div>
          <div class="integration-grid" data-reveal>
            <span>Skills<small>工作方法</small></span
            ><span>MCP<small>工具连接</small></span
            ><span>Plugins<small>插件管理</small></span
            ><span>Files<small>项目文件</small></span
            ><span>Git<small>代码改动</small></span
            ><span>BYOK<small>模型服务</small></span>
          </div>
        </div>
      </section>

      <section
        class="home-spotlight home-container"
        aria-labelledby="mission-title"
      >
        <div class="spotlight-card">
          <div class="spotlight-image">
            <img
              :src="missionImage"
              alt="Mission 功能执行与验证进度"
              loading="lazy"
              width="1520"
              height="1760"
            />
          </div>
          <div class="spotlight-copy">
            <p class="home-eyebrow">MISSION CONTROL</p>
            <h2 id="mission-title">目标明确，<br />过程可见。</h2>
            <p>
              为复杂任务设定目标。查看功能进度、Worker
              对话与验证结果，在需要时暂停或继续。
            </p>
            <a class="home-text-link" :href="docs('MISSIONS')"
              >了解 Mission <span aria-hidden="true">→</span></a
            >
          </div>
        </div>
      </section>

      <section
        class="home-workflows home-container"
        aria-labelledby="workflow-title"
      >
        <div class="section-heading">
          <h2 id="workflow-title">
            <HomeMotionText text="从一个具体问题开始。" />
          </h2>
          <p>让每次对话都有清楚的下一步。</p>
        </div>
        <div class="workflow-grid">
          <a
            v-for="workflow in workflows"
            :key="workflow[0]"
            :href="docs(workflow[3])"
            data-reveal
            ><span class="home-eyebrow">{{ workflow[0] }} / WORKFLOW</span>
            <h3>{{ workflow[1] }}</h3>
            <p>{{ workflow[2] }}</p>
            <span class="workflow-arrow" aria-hidden="true">↗</span></a
          >
        </div>
      </section>

      <section class="home-process home-wide" aria-labelledby="process-title">
        <div class="section-heading">
          <p class="home-eyebrow">BUILT AROUND YOUR CODE</p>
          <h2 id="process-title">工作在继续，<br />上下文也在。</h2>
          <p>在编辑器里完成一轮开发，让讨论、文件与执行记录彼此相连。</p>
        </div>
        <div class="process-grid">
          <div>
            <span>01 / PLAN</span>
            <h3>先把方案说清楚</h3>
            <p>计划模式支持讨论与审批。</p>
          </div>
          <div>
            <span>02 / BUILD</span>
            <h3>跟踪实际执行</h3>
            <p>按需展开工具与任务记录。</p>
          </div>
          <div>
            <span>03 / REVIEW</span>
            <h3>检查文件变化</h3>
            <p>切换 Diff 视图，定位代码。</p>
          </div>
          <div>
            <span>04 / CONTINUE</span>
            <h3>回到未完成的工作</h3>
            <p>搜索历史，接着上次继续。</p>
          </div>
        </div>
      </section>

      <section
        class="home-transparency home-wide"
        aria-labelledby="transparency-title"
      >
        <div class="section-heading centered">
          <h2 id="transparency-title">
            <HomeMotionText text="检查过程，再确认结果。" />
          </h2>
          <p>工具调用、权限请求和代码改动都有各自的入口。</p>
        </div>
        <ul>
          <li>工具记录</li>
          <li>权限审批</li>
          <li>文件 Diff</li>
          <li>代码问答</li>
          <li>任务进度</li>
        </ul>
        <a class="home-button home-button-outline" :href="docs('REVIEW')"
          >了解代码审阅 <span aria-hidden="true">→</span></a
        >
      </section>

      <section
        id="install"
        class="home-install home-container"
        aria-labelledby="install-title"
      >
        <div class="section-heading">
          <h2 id="install-title">
            <HomeMotionText text="下一次开发，从这里开始。" />
          </h2>
        </div>
        <div class="install-layout">
          <div class="install-steps">
            <div
              v-for="(step, index) in steps"
              :key="step.title"
              class="install-step"
              :class="{ active: activeStep === index }"
            >
              <h3>
                <button
                  :aria-expanded="activeStep === index"
                  :aria-controls="`install-step-${index}`"
                  @click="activeStep = index"
                >
                  <span class="step-index">0{{ index + 1 }}</span
                  >{{ step.title
                  }}<span class="step-toggle" aria-hidden="true">{{
                    activeStep === index ? '−' : '+'
                  }}</span>
                </button>
              </h3>
              <div
                v-show="activeStep === index"
                :id="`install-step-${index}`"
                class="install-step-content"
              >
                <p>{{ step.text }}</p>
                <a class="home-text-link" :href="docs(step.page)"
                  >{{ step.link }} <span aria-hidden="true">→</span></a
                >
              </div>
            </div>
            <div class="install-command">
              <p>下载 VSIX 后，也可在终端安装：</p>
              <div>
                <code>{{ installCommand }}</code
                ><button
                  :aria-label="copied ? '已复制安装命令' : '复制安装命令'"
                  @click="copyInstallCommand"
                >
                  {{ copied ? '已复制' : '复制' }}
                </button>
              </div>
              <p v-if="copyError" role="status">
                未能访问剪贴板，请选中命令手动复制。
              </p>
            </div>
          </div>
          <div class="install-preview">
            <img
              :src="steps[activeStep].image"
              :alt="steps[activeStep].title"
              loading="lazy"
              width="1400"
              height="1000"
            />
          </div>
        </div>
      </section>

      <section
        class="home-guides home-container"
        aria-labelledby="guides-title"
      >
        <div class="guides-heading">
          <h2 id="guides-title"><HomeMotionText text="继续了解 Droid。" /></h2>
          <a class="home-text-link" :href="docs('GUIDE')"
            >全部文档 <span aria-hidden="true">→</span></a
          >
        </div>
        <div class="guide-grid">
          <a
            v-for="guide in guides"
            :key="guide.page"
            :href="docs(guide.page)"
            data-reveal
            ><div class="guide-image">
              <img
                :src="guide.image"
                :alt="guide.title"
                loading="lazy"
                width="800"
                height="450"
              />
            </div>
            <p class="home-eyebrow">{{ guide.label }}</p>
            <h3>{{ guide.title }}</h3>
            <p>{{ guide.text }}</p></a
          >
        </div>
      </section>

      <section
        class="home-closing home-container"
        aria-labelledby="closing-title"
      >
        <div class="closing-card">
          <img :src="withBase('/droid.svg')" width="100" height="100" alt="" />
          <h2 id="closing-title">把 Droid<br />带进你的编辑器。</h2>
          <a class="home-button" :href="release"
            >下载扩展 <span aria-hidden="true">→</span></a
          >
        </div>
        <div class="closing-note">
          <span class="home-eyebrow">OPEN SOURCE / COMMUNITY BUILT</span>
          <p>社区维护，持续改进。</p>
          <a class="home-text-link" :href="repository"
            >在 GitHub 查看项目 <span aria-hidden="true">↗</span></a
          >
        </div>
      </section>
    </main>

    <footer class="home-footer home-wide">
      <div class="footer-brand">
        <img :src="withBase('/droid.svg')" width="62" height="62" alt="" /><span
          >DROID</span
        >
      </div>
      <div class="footer-content">
        <div class="footer-links">
          <div>
            <h2>产品</h2>
            <a href="#features">功能概览</a><a href="#models">模型与渠道</a
            ><a :href="release">下载扩展</a
            ><a :href="marketplace">Open VSX ↗</a>
          </div>
          <div>
            <h2>资源</h2>
            <a :href="docs('GUIDE')">文档首页</a
            ><a :href="docs('GETTING_STARTED')">使用指南</a
            ><a :href="docs('TROUBLESHOOTING')">常见问题</a
            ><a :href="`${repository}/releases`">更新日志</a>
          </div>
          <div>
            <h2>项目</h2>
            <a :href="repository">GitHub ↗</a
            ><a :href="docs('DEVELOPMENT')">参与开发</a
            ><a :href="`${repository}/issues`">问题反馈</a
            ><a :href="`${repository}/blob/main/LICENSE`">MIT 许可</a>
          </div>
        </div>
        <div class="footer-legal">
          <p>Factory Droid CLI 的社区非官方扩展，与 Factory 无隶属关系。</p>
          <p>
            页面设计参考
            <a href="https://factory.com/">Factory</a>；风车标识归原权利人所有。
          </p>
        </div>
      </div>
    </footer>
  </div>
</template>
