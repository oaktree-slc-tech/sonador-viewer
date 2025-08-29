import { createContext, useContext } from 'react';


const WorklistContext = createContext(undefined);

export const WorklistContextProvider = WorklistContext.Provider;


export const useWorklistContext = () => {
  const context = useContext(WorklistContext);
  if (!context) {
    throw new Error('useWorklistContext must be used within a WorklistContextProvider');
  }
  return context;
};
