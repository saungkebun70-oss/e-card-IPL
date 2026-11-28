import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  getSimulationDateIso,
  isSimulationEnabled,
  parseSimDateToLocalNoon,
  resetSimulationDataOnly,
  setSimulationDate,
  setSimulationEnabled,
  subscribeSimulationChanges,
  wipeSimulationDataAndDisable,
  type SimDateOption,
} from './simulationStore';

interface SimulationContextValue {
  simEnabled: boolean;
  simDateIso: SimDateOption;
  simNow: Date;
  simVersion: number;
  setSimEnabled: (enabled: boolean) => void;
  setSimDateIso: (dateIso: SimDateOption) => void;
  resetSimData: () => void;
  wipeAndDisableSim: () => void;
}

const SimulationContext = createContext<SimulationContextValue>({
  simEnabled: true,
  simDateIso: '2026-11-28',
  simNow: new Date(2026, 10, 28, 12, 0, 0),
  simVersion: 0,
  setSimEnabled: () => undefined,
  setSimDateIso: () => undefined,
  resetSimData: () => undefined,
  wipeAndDisableSim: () => undefined,
});

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const [simEnabled, setSimEnabledState] = useState<boolean>(() => isSimulationEnabled());
  const [simDateIso, setSimDateIsoState] = useState<SimDateOption>(() => getSimulationDateIso());
  const [simVersion, setSimVersion] = useState<number>(0);

  useEffect(() => {
    return subscribeSimulationChanges(() => {
      setSimEnabledState(isSimulationEnabled());
      setSimDateIsoState(getSimulationDateIso());
      setSimVersion((v) => v + 1);
    });
  }, []);

  const setSimEnabled = useCallback((enabled: boolean) => {
    setSimulationEnabled(enabled);
    setSimEnabledState(enabled);
  }, []);

  const setSimDateIso = useCallback((dateIso: SimDateOption) => {
    setSimulationDate(dateIso);
    setSimDateIsoState(dateIso);
  }, []);

  const resetSimData = useCallback(() => {
    resetSimulationDataOnly();
  }, []);

  const wipeAndDisableSim = useCallback(() => {
    wipeSimulationDataAndDisable();
    setSimEnabledState(false);
  }, []);

  const simNow = useMemo(() => parseSimDateToLocalNoon(simDateIso), [simDateIso]);

  const value = useMemo<SimulationContextValue>(
    () => ({
      simEnabled,
      simDateIso,
      simNow,
      simVersion,
      setSimEnabled,
      setSimDateIso,
      resetSimData,
      wipeAndDisableSim,
    }),
    [simEnabled, simDateIso, simNow, simVersion, setSimEnabled, setSimDateIso, resetSimData, wipeAndDisableSim]
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation(): SimulationContextValue {
  return useContext(SimulationContext);
}
