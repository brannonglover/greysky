export type Units = 'us' | 'si';

export type AlertPrefs = {
  nextHourPrecip: boolean;
  /** Official NWS watches and warnings. */
  severeWeather: boolean;
  /** SPC severe-weather outlooks, one to three days ahead. */
  severeOutlook: boolean;
  /** Grey Sky's own read of the forecast, before any official product exists. */
  strongStorm: boolean;
  /** Tropical cyclones whose forecast wind field reaches the user. */
  tropical: boolean;
  umbrella: boolean;
  sunscreen: boolean;
  dailySummary: boolean;
};

export type Settings = {
  units: Units;
  alerts: AlertPrefs;
};

export type SavedLocation = {
  id: string;
  name: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
};

export type WeatherAlert = {
  id: string;
  event: string;
  headline: string;
  description: string;
  severity: 'Minor' | 'Moderate' | 'Severe' | 'Extreme' | 'Unknown';
  onset?: string;
  ends?: string;
};

export type MinutePoint = {
  minute: number;
  precipitationMm: number;
  probability: number;
  isSnow: boolean;
};

export type HourPoint = {
  time: string;
  temperature: number;
  apparentTemperature: number;
  precipitationProbability: number;
  precipitation: number;
  weatherCode: number;
  cloudCover: number;
  visibility: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  uvIndex: number;
  humidity: number;
  dewPoint: number;
  pressure: number;
  isDay: boolean;
};

export type DayPoint = {
  date: string;
  weatherCode: number;
  temperatureMax: number;
  temperatureMin: number;
  apparentMax: number;
  apparentMin: number;
  sunrise: string;
  sunset: string;
  uvIndexMax: number;
  precipitationSum: number;
  precipitationHours: number;
  precipitationProbabilityMax: number;
  windSpeedMax: number;
  windGustsMax: number;
  windDirection: number;
  snowfallSum: number;
};

export type CurrentWeather = {
  time: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  isDay: boolean;
  precipitation: number;
  weatherCode: number;
  cloudCover: number;
  pressure: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  visibility: number;
};

export type WeatherBundle = {
  latitude: number;
  longitude: number;
  timezone: string;
  current: CurrentWeather;
  minutely: MinutePoint[];
  hourly: HourPoint[];
  daily: DayPoint[];
  nowcastSummary: string;
  daySummary: string;
  alerts: WeatherAlert[];
};

export type HourlyMetric = 'temp' | 'feels' | 'precip';
