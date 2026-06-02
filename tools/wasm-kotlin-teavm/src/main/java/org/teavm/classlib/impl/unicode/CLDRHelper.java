package org.teavm.classlib.impl.unicode;

import org.teavm.platform.metadata.IntResource;
import org.teavm.platform.metadata.ResourceArray;
import org.teavm.platform.metadata.ResourceMap;
import org.teavm.platform.metadata.StringResource;

public final class CLDRHelper {
    private CLDRHelper() {
    }

    public static String getCode(String language, String country) {
        return country != null && !country.isEmpty() ? country : language;
    }

    public static String getLikelySubtags(String locale) {
        return "en";
    }

    public static String resolveCountry(String language, String country) {
        return "";
    }

    public static String[] resolveEras(String language, String country) {
        return new String[0];
    }

    public static String[] resolveAmPm(String language, String country) {
        return new String[0];
    }

    public static String[] resolveMonths(String language, String country) {
        return new String[0];
    }

    public static String[] resolveShortMonths(String language, String country) {
        return new String[0];
    }

    public static String[] resolveWeekdays(String language, String country) {
        return new String[0];
    }

    public static String[] resolveShortWeekdays(String language, String country) {
        return new String[0];
    }

    public static String getTimeZoneName(String language, String country, String id) {
        return null;
    }

    public static ResourceMap<TimeZoneLocalization> getTimeZoneLocalizationMap() {
        return null;
    }

    public static ResourceMap<ResourceMap<StringResource>> getLanguagesMap() {
        return null;
    }

    public static ResourceMap<ResourceMap<StringResource>> getCountriesMap() {
        return null;
    }

    public static StringResource getDefaultLocale() {
        return null;
    }

    public static ResourceArray<StringResource> getAvailableLocales() {
        return null;
    }

    public static ResourceMap<IntResource> getMinimalDaysInFirstWeek() {
        return null;
    }

    public static ResourceMap<IntResource> getFirstDayOfWeek() {
        return null;
    }

    public static DateFormatCollection resolveDateFormats(String language, String country) {
        return null;
    }

    public static DateFormatCollection resolveTimeFormats(String language, String country) {
        return null;
    }

    public static DateFormatCollection resolveDateTimeFormats(String language, String country) {
        return null;
    }

    public static String resolveNumberFormat(String language, String country) {
        return "#";
    }

    public static String resolvePercentFormat(String language, String country) {
        return "#";
    }

    public static String resolveCurrencyFormat(String language, String country) {
        return "#";
    }

    public static DecimalData resolveDecimalData(String language, String country) {
        return null;
    }

    public static CurrencyLocalization resolveCurrency(String language, String country, String currency) {
        return null;
    }
}
