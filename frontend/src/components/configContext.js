import { createContext, useContext } from 'react'

export const ConfigContext = createContext({ groupBy: ['environment', 'region', 'name'] })

export const useConfig = () => useContext(ConfigContext)
