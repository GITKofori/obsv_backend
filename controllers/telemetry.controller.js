const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const pool = require("../util/db");

exports.dashboard = async (req, res) => {
  try {
    const lastSyncRS = await pool.query("SELECT * FROM last_sync");
    let rBody = { lastSync: "N/A", statistics: null, numberTypeSub: null };
    if (lastSyncRS.rows.length > 0) {
      rBody.lastSync = lastSyncRS.rows[0].synced_at;
    }

    const dashboardRS = await pool.query("SELECT * from dashboard_statistic");
    if (dashboardRS.rows.length > 0) {
      rBody.statistics = dashboardRS.rows;
    }

    const numberAverageYearTypeRS = await pool.query(
      "SELECT * from number_of_average_by_year_type"
    );
    if (numberAverageYearTypeRS.rows.length > 0) {
      rBody.averageYearType = numberAverageYearTypeRS.rows;
    }

    const numberDataByTypeRS = await pool.query(
      "SELECT * from number_of_datapoints_by_type"
    );
    if (numberDataByTypeRS.rows.length > 0) {
      rBody.countByType = numberDataByTypeRS.rows;
    }

    const numberDataByTypeByYearRS = await pool.query(
      "SELECT * from number_of_datapoints_by_type_year"
    );
    if (numberDataByTypeByYearRS.rows.length > 0)
      rBody.countByTypeByYear = numberDataByTypeByYearRS.rows;

    const typesSubTypesRS = await pool.query(
      "SELECT * from number_of_subtypes_of_type"
    );
    if (typesSubTypesRS.rows.length > 0) {
      rBody.numberTypeSub = typesSubTypesRS.rows;
    }

    const valueEleByYear = await pool.query(
      "SELECT * from view_dados_eletricos_by_year"
    );
    if (valueEleByYear.rows.length > 0) {
      rBody.valueEleByYear = valueEleByYear.rows;
    }

    const dadosPetroliferos = await pool.query(
      "SELECT * from lista_dados_petroliferos_subtipos_consumidor"
    );
    if (dadosPetroliferos.rows.length > 0) {
      rBody.dadosPetroliferos = dadosPetroliferos.rows;
    }

    // Consumer type aggregation (for sector chart)
    const consumerTypeRS = await pool.query(`
      SELECT ct.descr AS name,
             ROUND(AVG(CAST(m.value AS NUMERIC))) AS value,
             COUNT(*) AS record_count
      FROM metrics m
      JOIN consumer_types ct ON ct.id = m.consumer_type
      WHERE m.value ~ '^[0-9]+\\.?[0-9]*$'
      GROUP BY ct.descr
      ORDER BY value DESC
    `);
    if (consumerTypeRS.rows.length > 0) {
      rBody.consumerTypeStats = consumerTypeRS.rows;
    }

    res.json(rBody);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.types = async (req, res) => {
  try {
    const types = await pool.query(
      "SELECT descr as value, UPPER(descr) as label from types"
    );
    if (types.rows.length > 0) {
      res.json(types.rows);
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.charts = async (req, res) => {
  try {
    const {
      dataType = "electricity",
      startYear = "2015",
      endYear = "2024",
    } = req.query;

    // Map data types to database type IDs
    const typeMapping = {
      electricity: 1,
      gas: 2,
      petroleum: 3,
      renewable: 4,
      consumption: 5,
    };

    const typeId = typeMapping[dataType] || 1;

    // Validate year range (2015-2024 only)
    const start = Math.max(2015, parseInt(startYear));
    const end = Math.min(2024, parseInt(endYear));

    // Fixed query for years 2015-2024 only
    const query = `
      SELECT 
        year,
        SUM(CAST(value AS NUMERIC)) as total_value,
        COUNT(*) as record_count
      FROM public.metrics 
      WHERE type = $1 
        AND year BETWEEN $2 AND $3
      GROUP BY year 
      ORDER BY year ASC
    `;

    const queryParams = [typeId, start, end];

    const result = await pool.query(query, queryParams);

    // Transform data for charts - simplified for years only
    const chartData = result.rows.map((item) => ({
      value: parseFloat(item.total_value) || 0,
      label: item.year.toString(),
      year: item.year,
    }));

    res.json(chartData);
  } catch (error) {
    console.error("Error fetching chart data:", error);
    res.status(500).json({ error: "Failed to fetch chart data" });
  }
};

// Transform database data for chart consumption
function transformDataForChart(data, timeInterval) {
  if (!data || data.length === 0) {
    return [];
  }

  switch (timeInterval) {
    case "yearly":
      return data.map((item) => ({
        value: parseFloat(item.total_value) || 0,
        label: item.year.toString(),
        year: item.year,
      }));

    case "quarterly":
      return data.map((item) => ({
        value: parseFloat(item.avg_value) || 0,
        label: `Q${item.quarter} ${item.year}`,
        year: item.year,
        quarter: item.quarter,
      }));

    case "monthly":
      return data.map((item, index) => ({
        value: parseFloat(item.avg_value) || 0,
        label: `M${index + 1}`,
        year: item.year,
        sub_type: item.sub_type,
      }));

    default:
      return data.map((item) => ({
        value: parseFloat(item.total_value) || 0,
        label: item.year.toString(),
        year: item.year,
      }));
  }
}

exports.metrics = async (req, res) => {
  try {
    const page = req.query.page;
    const search = req.query.search || null;
    const pageLimit = req.query.limit;
    const categories = req.query.categories || null;
    const filters = {
      page,
      limit: pageLimit,
      ...(search && { search }),
      ...(categories && { categories }),
    };
    console.log("FILTERS", filters);

    let query = `SELECT m.id,UPPER(t.descr) as type, st.descr as sub_type, ct.descr as consumer_type, year, value FROM metrics m 
      inner join types t on t.id = m.type 
      inner join sub_types st on st.id = m.sub_type
      inner join consumer_types ct on ct.id = m.consumer_type WHERE 1=1`;
    const queryParams = [];
    const countParams = [];
    let countQuery = `SELECT COUNT(*) FROM metrics m 
    inner join types t on t.id = m.type 
    inner join sub_types st on st.id = m.sub_type
    inner join consumer_types ct on ct.id = m.consumer_type WHERE 1=1`;
    console.log(filters);
    if (filters.search) {
      query += " AND (ct.descr like $1)";
      queryParams.push(
        `%${filters.search == "undefined" ? "" : filters.search}%`
      );
      countQuery += " AND (ct.descr like $1)";
      countParams.push(
        `%${filters.search == "undefined" ? "" : filters.search}%`
      );
    }

    if (filters.categories) {
      query += " AND t.descr like $2";
      queryParams.push(
        `%${filters.categories == "undefined" ? "" : filters.categories}%`
      );
      countQuery += " AND t.descr like $2";
      countParams.push(
        `%${filters.categories == "undefined" ? "" : filters.categories}%`
      );
    }
    const limit = filters.limit ? parseInt(filters.limit, 10) : 10;
    const pageNum = filters.page ? parseInt(filters.page, 10) : 1;
    const offset = (pageNum - 1) * limit;

    if (!filters.search && !filters.categories) query += " LIMIT $1 OFFSET $2";
    else query += " LIMIT $3 OFFSET $4";
    queryParams.push(limit, offset);
    console.log(query);
    const metricsPromise = pool.query(query, queryParams).catch((err) => {
      console.log(err);
    });
    const countPromise = pool.query(countQuery, countParams).catch((err) => {
      console.log(err);
    });
    console.log("TESTE");

    const [metrics, countResult] = await Promise.all([
      metricsPromise,
      countPromise,
    ]).catch((err) => console.log(err));

    res.status(200).json({
      data: metrics.rows,
      total: parseInt(countResult.rows[0].count, 10), // Extract count from the result
      page: pageNum,
      limit: limit,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.municipioStatistics = async (req, res) => {
  try {
    const municipio = req.params.municipio; // Get municipio from URL path

    // Base parameters for all queries
    const baseParams = [municipio];

    // Query 1: Records count per type (all years combined)
    const recordsPerTypeQuery = `
      SELECT 
        t.descr as type_name,
        m.type,
        COUNT(*) as record_count,
        MIN(m.year) as earliest_year,
        MAX(m.year) as latest_year
      FROM metrics_municipio m 
      INNER JOIN types t ON t.id = m.type 
      WHERE m.municipio = $1
      GROUP BY m.type, t.descr
      ORDER BY record_count DESC
    `;

    // Query 2: Records count per type grouped by year
    const recordsPerTypeByYearQuery = `
      SELECT 
        t.descr as type_name,
        m.type,
        m.year,
        COUNT(*) as record_count
      FROM metrics_municipio m 
      INNER JOIN types t ON t.id = m.type 
      WHERE m.municipio = $1
      GROUP BY m.type, t.descr, m.year
      ORDER BY m.year DESC, record_count DESC
    `;

    // Query 3: Average values per consumer type (all years combined)
    const avgPerConsumerQuery = `
      SELECT 
        ct.descr as consumer_type_name,
        m.consumer_type,
        COUNT(*) as record_count,
        AVG(CAST(m.value AS NUMERIC)) as average_value,
        MIN(CAST(m.value AS NUMERIC)) as min_value,
        MAX(CAST(m.value AS NUMERIC)) as max_value,
        STDDEV(CAST(m.value AS NUMERIC)) as std_deviation
      FROM metrics_municipio m 
      INNER JOIN consumer_types ct ON ct.id = m.consumer_type 
      WHERE m.municipio = $1
      AND m.value ~ '^[0-9]+\.?[0-9]*$' -- Only numeric values
      GROUP BY m.consumer_type, ct.descr
      ORDER BY average_value DESC
    `;

    // Query 4: Average values per consumer type grouped by year
    const avgPerConsumerByYearQuery = `
      SELECT 
        ct.descr as consumer_type_name,
        m.consumer_type,
        m.year,
        COUNT(*) as record_count,
        AVG(CAST(m.value AS NUMERIC)) as average_value,
        MIN(CAST(m.value AS NUMERIC)) as min_value,
        MAX(CAST(m.value AS NUMERIC)) as max_value
      FROM metrics_municipio m 
      INNER JOIN consumer_types ct ON ct.id = m.consumer_type 
      WHERE m.municipio = $1
      AND m.value ~ '^[0-9]+\.?[0-9]*$'
      GROUP BY m.consumer_type, ct.descr, m.year
      ORDER BY m.year DESC, average_value DESC
    `;

    // Query 5: Year-over-year trends
    const yearTrendsQuery = `
      SELECT 
        m.year,
        COUNT(*) as total_records,
        COUNT(DISTINCT m.type) as unique_types,
        COUNT(DISTINCT m.sub_type) as unique_sub_types,
        COUNT(DISTINCT m.consumer_type) as unique_consumer_types,
        AVG(CAST(m.value AS NUMERIC)) as avg_value_per_year,
        MIN(CAST(m.value AS NUMERIC)) as min_value_per_year,
        MAX(CAST(m.value AS NUMERIC)) as max_value_per_year
      FROM metrics_municipio m 
      WHERE m.municipio = $1
      AND m.value ~ '^[0-9]+\.?[0-9]*$'
      GROUP BY m.year
      ORDER BY m.year DESC
    `;

    // Query 6: Sub-type distribution (all years combined)
    const subTypeDistQuery = `
      SELECT 
        st.descr as sub_type_name,
        t.descr as type_name,
        m.sub_type,
        m.type,
        COUNT(*) as record_count,
        AVG(CAST(m.value AS NUMERIC)) as average_value
      FROM metrics_municipio m 
      INNER JOIN sub_types st ON st.id = m.sub_type 
      INNER JOIN types t ON t.id = m.type 
      WHERE m.municipio = $1
      AND m.value ~ '^[0-9]+\.?[0-9]*$'
      GROUP BY m.sub_type, m.type, st.descr, t.descr
      ORDER BY record_count DESC
    `;

    // Query 7: Sub-type distribution grouped by year
    const subTypeDistByYearQuery = `
      SELECT 
        st.descr as sub_type_name,
        t.descr as type_name,
        m.sub_type,
        m.type,
        m.year,
        COUNT(*) as record_count,
        AVG(CAST(m.value AS NUMERIC)) as average_value
      FROM metrics_municipio m 
      INNER JOIN sub_types st ON st.id = m.sub_type 
      INNER JOIN types t ON t.id = m.type 
      WHERE m.municipio = $1
      AND m.value ~ '^[0-9]+\.?[0-9]*$'
      GROUP BY m.sub_type, m.type, st.descr, t.descr, m.year
      ORDER BY m.year DESC, record_count DESC
    `;

    // Query 8: Overall municipality summary
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT m.type) as total_types,
        COUNT(DISTINCT m.sub_type) as total_sub_types,
        COUNT(DISTINCT m.consumer_type) as total_consumer_types,
        COUNT(DISTINCT m.year) as years_covered,
        MIN(m.year) as earliest_data_year,
        MAX(m.year) as latest_data_year,
        COUNT(CASE WHEN m.value ~ '^[0-9]+\.?[0-9]*$' THEN 1 END) as numeric_records,
        COUNT(CASE WHEN m.value !~ '^[0-9]+\.?[0-9]*$' THEN 1 END) as non_numeric_records
      FROM metrics_municipio m 
      WHERE m.municipio = $1
    `;

    // Execute all queries in parallel
    const [
      recordsPerType,
      recordsPerTypeByYear,
      avgPerConsumer,
      avgPerConsumerByYear,
      yearTrends,
      subTypeDist,
      subTypeDistByYear,
      summary,
    ] = await Promise.all([
      pool.query(recordsPerTypeQuery, baseParams),
      pool.query(recordsPerTypeByYearQuery, baseParams),
      pool.query(avgPerConsumerQuery, baseParams),
      pool.query(avgPerConsumerByYearQuery, baseParams),
      pool.query(yearTrendsQuery, baseParams),
      pool.query(subTypeDistQuery, baseParams),
      pool.query(subTypeDistByYearQuery, baseParams),
      pool.query(summaryQuery, baseParams),
    ]);

    // Response structure
    res.status(200).json({
      municipio: municipio,
      summary: summary.rows[0],
      overall_statistics: {
        records_per_type: recordsPerType.rows,
        consumer_type_averages: avgPerConsumer.rows,
        sub_type_distribution: subTypeDist.rows,
      },
      yearly_breakdown: {
        year_trends: yearTrends.rows,
        records_per_type_by_year: recordsPerTypeByYear.rows,
        consumer_type_averages_by_year: avgPerConsumerByYear.rows,
        sub_type_distribution_by_year: subTypeDistByYear.rows,
      },
      metadata: {
        generated_at: new Date().toISOString(),
        total_queries_executed: 8,
      },
    });
  } catch (err) {
    console.error("Municipality statistics error:", err);
    res.status(500).json({
      message: "Error generating municipality statistics",
      error: err.message,
    });
  }
};
