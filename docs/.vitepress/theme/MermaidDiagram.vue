<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useData } from 'vitepress';

const props = defineProps({ code: { type: String, required: true } });
const { isDark } = useData();
const diagram = ref('');
const error = ref('');
let revision = 0;
let stop;

onMounted(() => {
  stop = watch([() => props.code, isDark], async () => {
    const current = ++revision;
    try {
      const { default: mermaid } = await import('mermaid');
      if (current !== revision) return;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark.value ? 'dark' : 'default' });
      const { svg } = await mermaid.render(`droid-diagram-${crypto.randomUUID()}`, props.code);
      if (current === revision) { diagram.value = svg; error.value = ''; }
    } catch (cause) {
      if (current === revision) error.value = `图表无法显示：${cause instanceof Error ? cause.message : String(cause)}`;
    }
  }, { immediate: true });
});
onUnmounted(() => { revision++; stop?.(); });
</script>

<template>
  <figure class="droid-diagram" aria-label="架构流程图">
    <div v-if="diagram && !error" v-html="diagram" />
    <template v-else>
      <p v-if="error" role="status">{{ error }}</p>
      <pre><code>{{ code }}</code></pre>
    </template>
  </figure>
</template>
