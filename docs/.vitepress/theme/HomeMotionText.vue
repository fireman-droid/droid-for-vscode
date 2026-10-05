<script setup>
import { computed } from 'vue';

const props = defineProps({
  text: { type: String, required: true },
  mode: { type: String, default: 'reveal' },
  delay: { type: Number, default: 0 },
});
// Keep closing punctuation with its character and Latin words intact when wrapping.
const units = computed(
  () => props.text.match(/[A-Za-z0-9]+|.[，。！？、：；）】》”’]?/gu) || [],
);
</script>

<template>
  <span :data-motion-text="mode" :data-delay="delay" :aria-label="text">
    <span
      v-for="(unit, index) in units"
      :key="index"
      class="motion-word"
      aria-hidden="true"
      ><span
        v-for="(char, position) in Array.from(unit)"
        :key="position"
        class="motion-char"
        :data-char="char"
        >{{ char }}</span
      ></span
    >
  </span>
</template>
