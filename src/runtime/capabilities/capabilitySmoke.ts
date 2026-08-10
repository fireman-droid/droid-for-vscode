import {
  FactoryDroidCapabilityProbe,
  isCapabilitySmokeSuccessful,
} from './FactoryDroidCapabilityProbe';

if (process.env.DROIDVISX_RUN_CAPABILITY_SMOKE !== '1') {
  process.exitCode = 2;
} else {
  const report = await new FactoryDroidCapabilityProbe().probe(process.cwd());
  console.log(JSON.stringify(report));
  if (!isCapabilitySmokeSuccessful(report)) {
    process.exitCode = 1;
  }
}
