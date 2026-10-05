<script setup>
import { useData } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import DroidHome from './DroidHome.vue';

const { frontmatter } = useData();
</script>

<template>
  <DroidHome v-if="frontmatter.layout === 'landing'" />
  <DefaultTheme.Layout v-else />
</template>
